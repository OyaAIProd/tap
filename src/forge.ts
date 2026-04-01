/**
 * Forge — tap creation pipeline (Deno-side).
 *
 * Replaces extension/protocol/forge.js. Page analysis runs via page.eval RPC,
 * strategy recommendation runs locally. No extension-internal APIs needed.
 */

import { createPageProxy, type RpcSend } from "./page.ts";
import { listTaps, type TapModule } from "./executor.ts";

/**
 * Find similar taps as reference for forge. Scores by site match and strategy type.
 * Returns top 3 with serialized code snippets for few-shot context.
 */
export function findSimilarTaps(
  url: string,
  strategies: Array<Record<string, unknown>>,
  taps: TapModule[],
): Array<{ site: string; name: string; strategy: string; code: string; description: string; hint: string }> {
  let hostname = "";
  try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch { /* */ }
  const site = hostname.split(".")[0] || "";
  const strategyTypes = strategies.map((s) => s.type as string);

  const scored = taps.map((tap) => {
    let score = 0;
    const hints: string[] = [];
    if (tap.site === site) { score += 10; hints.push("same site"); }
    const code = tap.extract?.toString() || tap.run?.toString() || "";
    let strategy = "dom";
    if (code.includes("fetch(") || code.includes("fetch (")) strategy = "api";
    else if (code.includes("__NEXT_DATA__") || code.includes("__INITIAL") || code.includes("__NUXT")) strategy = "ssr";
    if (strategyTypes.includes(strategy)) { score += 5; hints.push(`${strategy} strategy`); }
    return {
      site: tap.site, name: tap.name, strategy, code,
      description: tap.description || "",
      hint: hints.join(", ") || "similar pattern",
      score,
    };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Find all existing taps for the same site.
 * Shown prominently in forge_inspect so AI knows what already exists.
 */
export function findExistingTaps(
  url: string,
  taps: TapModule[],
): Array<{ site: string; name: string; description: string }> {
  let hostname = "";
  try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch { /* */ }
  // Match by hostname prefix (e.g., "reddit" from "reddit.com", "old.reddit.com")
  const site = hostname.split(".").find((p) => p !== "www" && p !== "old" && p !== "m") || "";
  return taps
    .filter((t) => t.site === site)
    .map((t) => ({ site: t.site, name: t.name, description: t.description || "" }));
}

/**
 * Self-contained page analysis function, serialized as a string for page.eval.
 * Must have zero closures, zero imports — runs in the page's main world.
 */
export const analyzePageContextSource = `(() => {
  const result = {
    framework: null,
    ssr_state: {},
    api_hints: [],
    interactive: { forms: [], inputs: [], buttons: [], links_count: 0 },
    storage_keys: [],
    meta: {}
  }

  // Framework detection
  if (window.__NEXT_DATA__) {
    result.framework = { name: 'next', evidence: '__NEXT_DATA__' }
  } else if (window.__NUXT__ || window.__NUXT_DATA__) {
    result.framework = { name: 'nuxt', evidence: window.__NUXT__ ? '__NUXT__' : '__NUXT_DATA__' }
  } else if (window.__vue_app__) {
    result.framework = { name: 'vue3', evidence: '__vue_app__' }
  } else if (document.querySelector('[data-v-]')) {
    result.framework = { name: 'vue2', evidence: 'data-v- attributes' }
  } else if (document.querySelector('[data-reactroot]') || document.querySelector('#__next')) {
    result.framework = { name: 'react', evidence: 'data-reactroot or #__next' }
  } else if (window.angular || document.querySelector('[ng-app]') || document.querySelector('[ng-version]')) {
    result.framework = { name: 'angular', evidence: 'angular globals or ng- attributes' }
  } else if (document.querySelector('[class*="svelte-"]')) {
    result.framework = { name: 'svelte', evidence: 'svelte- class prefixes' }
  } else {
    result.framework = { name: 'unknown', evidence: 'no framework markers detected' }
  }

  // SSR state extraction
  const SSR_GLOBALS = [
    '__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__', '__INITIAL_STATE__',
    '__INITIAL_SSR_STATE__', '__pinia', '__PRELOADED_STATE__',
    '__APP_DATA__', '__SSR_DATA__', '__APOLLO_STATE__', '__RELAY_STORE__'
  ]

  for (const key of SSR_GLOBALS) {
    const val = window[key]
    if (val == null) continue
    try {
      const serialized = JSON.stringify(val)
      const topKeys = typeof val === 'object' && val !== null
        ? Object.keys(val).slice(0, 30) : []
      result.ssr_state[key] = { size: serialized.length, keys: topKeys, sample: serialized.substring(0, 3000) }
    } catch {
      result.ssr_state[key] = { size: -1, keys: [], sample: '[unserializable]' }
    }
  }

  // Scan for other __UPPER_CASE globals
  try {
    for (const key of Object.getOwnPropertyNames(window)) {
      if (SSR_GLOBALS.includes(key) || !/^__[A-Z]/.test(key)) continue
      try {
        const val = window[key]
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const s = JSON.stringify(val)
          if (s.length > 500) {
            result.ssr_state[key] = { size: s.length, keys: Object.keys(val).slice(0, 20), sample: s.substring(0, 1500) }
          }
        }
      } catch {}
    }
  } catch {}

  // API hints from performance entries
  try {
    const entries = performance.getEntriesByType('resource')
    result.api_hints = entries
      .filter(e => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest')
      .slice(0, 50)
      .map(e => {
        let pathname = ''
        try { pathname = new URL(e.name).pathname } catch {}
        return { url: e.name, pathname, type: e.initiatorType, duration_ms: Math.round(e.duration), size: e.transferSize || e.decodedBodySize || 0 }
      })
  } catch {}

  // Interactive elements
  try {
    const forms = document.querySelectorAll('form')
    result.interactive.forms = Array.from(forms).slice(0, 10).map(f => ({
      action: f.action || '', method: (f.method || 'GET').toUpperCase(), id: f.id || null,
      inputs: Array.from(f.querySelectorAll('input,textarea,select')).slice(0, 15).map(i => ({
        tag: i.tagName.toLowerCase(), type: i.type || '', name: i.name || '', placeholder: i.placeholder || ''
      }))
    }))
  } catch {}

  try {
    const inputs = document.querySelectorAll('input:not(form input), textarea:not(form textarea), [contenteditable="true"], [role="textbox"]')
    result.interactive.inputs = Array.from(inputs).slice(0, 20).map(i => ({
      tag: i.tagName.toLowerCase(), type: i.type || i.getAttribute('role') || '',
      name: i.name || '', placeholder: i.placeholder || i.getAttribute('aria-label') || ''
    }))
  } catch {}

  try {
    const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]')
    result.interactive.buttons = Array.from(buttons)
      .filter(b => b.offsetParent !== null)
      .slice(0, 30)
      .map(b => ({ text: (b.textContent || '').trim().substring(0, 60), type: b.type || b.tagName.toLowerCase() }))
  } catch {}

  try { result.interactive.links_count = document.querySelectorAll('a[href]').length } catch {}
  try { result.storage_keys = Object.keys(localStorage).slice(0, 30) } catch {}

  result.meta = {
    charset: document.characterSet || '', lang: document.documentElement.lang || '',
    description: (document.querySelector('meta[name="description"]') || {}).content || '',
    og_title: (document.querySelector('meta[property="og:title"]') || {}).content || '',
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
    ready_state: document.readyState,
    scroll_height: document.documentElement.scrollHeight,
    viewport_height: window.innerHeight,
  }

  return result
})()`;

/**
 * Check tap code quality before saving. Returns warnings (non-blocking).
 * Like a linter — save always succeeds, but AI sees what to fix.
 */
export function checkTapQuality(code: string): string[] {
  const warnings: string[] = [];

  // --- Format validation (these cause tap.run to fail) ---
  if (!code.includes("export default")) {
    warnings.push("ERROR: Missing 'export default' — tap must export a default object");
  }
  if (!/site\s*:\s*["'`]/.test(code)) {
    warnings.push("ERROR: Missing site field — tap must have site: \"...\" (tap.run will fail)");
  }
  if (!/name\s*:\s*["'`]/.test(code)) {
    warnings.push("ERROR: Missing name field — tap must have name: \"...\" (tap.run will fail)");
  }
  const hasRun = /\brun\s*\(/.test(code) || /\brun\s*:/.test(code);
  const hasExtract = /\bextract\s*\(/.test(code) || /\bextract\s*:/.test(code);
  if (!hasRun && !hasExtract) {
    warnings.push("ERROR: Missing run() or extract() — tap needs an execution method");
  }

  // --- Quality warnings (non-blocking) ---
  if (!code.includes("health:") && !code.includes("health :")) {
    warnings.push("Missing health contract — add health: { min_rows: N, non_empty: ['field'] }");
  }
  if (code.includes("fetch(") && !code.includes("credentials")) {
    warnings.push("API fetch without credentials: 'include' — authenticated endpoints will fail silently");
  }
  if (code.includes("querySelectorAll") && !code.includes("fetch(")) {
    warnings.push("DOM-only extraction is fragile — consider API or SSR state if available");
  }
  return warnings;
}

/**
 * Recommend extraction strategies based on page analysis.
 * Runs in Deno (no browser access needed — pure logic).
 */
export function recommendStrategies(
  analysis: Record<string, unknown>,
  url: string,
): Array<Record<string, unknown>> {
  const strategies: Array<Record<string, unknown>> = [];
  let hostname = "";
  try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch { /* */ }
  const site = hostname.split(".")[0] || "example";

  const ssrState = (analysis.ssr_state || {}) as Record<string, Record<string, unknown>>;
  const ssrKeys = Object.keys(ssrState);

  // 1. SSR state — best: zero network
  if (ssrKeys.length > 0) {
    const totalSize = ssrKeys.reduce((s, k) => s + ((ssrState[k]?.size as number) || 0), 0);
    const primaryGlobal = ssrKeys[0];
    const topKeys = ((ssrState[primaryGlobal]?.keys as string[]) || []).slice(0, 10).join(", ");
    strategies.push({
      rank: 1,
      type: "ssr",
      reason: `SSR state found: ${ssrKeys.join(", ")} (${(totalSize / 1024).toFixed(0)}KB)`,
      globals: ssrKeys,
      template: `export default {
  site: "${site}", name: "TODO",
  description: "TODO",
  url: "${url}",
  health: { min_rows: 5, non_empty: ["title"] },
  extract: () => {
    const state = window.${primaryGlobal}
    // Keys: ${topKeys}
    // Vue/Nuxt: unwrap refs if needed
    let data = state?.props?.pageProps || state
    if (data?._rawValue) data = data._rawValue
    const items = data?.items || data?.list || (Array.isArray(data) ? data : Object.values(data || {}))
    return items.map(item => ({
      title: String(item?.title || item?.name || ''),
      /* TODO: map fields with String() coercion and ?. chaining */
    })).filter(item => item.title)
  }
}`,
    });
  }

  // 2. API — good: one fetch
  const apiHints = (analysis.api_hints || []) as Array<Record<string, unknown>>;
  const jsonAPIs = apiHints.filter((h) =>
    /\/(api|graphql|v[0-9]|ajax|rpc|data|feed)\b/i.test(h.pathname as string) ||
    /\.json(\?|$)/.test(h.url as string)
  );
  if (jsonAPIs.length > 0) {
    const bestAPI = jsonAPIs.sort((a, b) => (b.size as number) - (a.size as number))[0];
    strategies.push({
      rank: strategies.length + 1,
      type: "api",
      reason: `Found ${jsonAPIs.length} API endpoint(s)`,
      endpoints: jsonAPIs.slice(0, 8).map((a) => ({ url: a.url, pathname: a.pathname, size: a.size })),
      template: `export default {
  site: "${site}", name: "TODO",
  description: "TODO",
  url: "${url}",
  health: { min_rows: 5, non_empty: ["title"] },
  extract: async () => {
    const res = await fetch("${bestAPI.url}", { credentials: "include" })
    const data = await res.json()
    // Unwrap nested data (common: data.data.list, data.items, data.result)
    const items = data?.data?.list || data?.data?.items || data?.data || data?.items || data
    if (!Array.isArray(items)) return []
    return items.map(item => ({
      title: String(item?.title || item?.name || ''),
      /* TODO: map fields with String() coercion and ?. chaining */
    })).filter(item => item.title)
  }
}`,
    });
  }

  // 3. DOM — always available
  strategies.push({
    rank: strategies.length + 1,
    type: "dom",
    reason: "Extract from DOM. Less reliable but always available.",
    template: `export default {
  site: "${site}", name: "TODO",
  description: "TODO",
  url: "${url}",
  waitFor: "TODO_selector",
  health: { min_rows: 3, non_empty: ["title"] },
  extract: () => {
    const seen = new Set()
    return Array.from(document.querySelectorAll("TODO_primary, TODO_fallback"))
      .map((el, i) => ({
        rank: String(i + 1),
        title: el.querySelector('a, h3, h2, strong')?.textContent?.trim() || '',
        /* TODO: map fields with ?.textContent?.trim() */
      }))
      .filter(item => {
        if (!item.title || seen.has(item.title)) return false
        seen.add(item.title)
        return true
      })
  }
}`,
  });

  return strategies;
}

/**
 * Verify extraction logic on a live page. Returns diagnostics on failure
 * so the AI can self-correct without human intervention.
 */
export async function forgeVerify(
  url: string,
  expression: string,
  send: RpcSend,
  waitMs = 2000,
): Promise<Record<string, unknown>> {
  const page = createPageProxy(send);
  await page.nav(url);
  await page.wait(waitMs);

  let result: unknown;
  let evalError: string | null = null;
  try {
    result = await page.eval(expression);
  } catch (e) {
    evalError = String(e);
    result = null;
  }

  const isEmpty = result === null || result === undefined ||
    (Array.isArray(result) && result.length === 0);

  if (!isEmpty && !evalError) {
    return { result, ok: true };
  }

  // Gather diagnostics from the page to help AI self-correct
  let diagnostics: Record<string, unknown> = {};
  try {
    diagnostics = (await page.eval(`(() => ({
      page_url: location.href,
      page_title: document.title,
      ready_state: document.readyState,
      element_count: document.querySelectorAll('*').length,
      visible_text_sample: document.body?.innerText?.substring(0, 300) || ''
    }))()`)) as Record<string, unknown>;
  } catch { /* diagnostics are best-effort */ }

  if (evalError) {
    diagnostics.error_message = evalError;
    diagnostics.suggestion =
      "Expression threw error — check syntax and that referenced elements/APIs exist on this page.";
  } else {
    diagnostics.suggestion =
      "Result is empty — check selectors, page load timing, or authentication.";
  }

  return { result, ok: false, diagnostics };
}

/**
 * Inspect a page for tap forging. Gathers data via page.eval RPC,
 * then recommends strategies locally.
 */
export async function forgeInspect(
  url: string,
  send: RpcSend,
  tapDirs?: string[],
): Promise<Record<string, unknown>> {
  const page = createPageProxy(send);

  // Navigate to target page
  if (url) {
    await page.nav(url);
  }

  // Gather page analysis via eval (runs in page context)
  const analysis = (await page.eval(analyzePageContextSource)) as Record<string, unknown>;

  // Get cookies for auth detection
  let cookies: Array<Record<string, string>> = [];
  try {
    const raw = await page.cookies();
    if (Array.isArray(raw)) cookies = raw as Array<Record<string, string>>;
  } catch { /* no cookies API */ }

  const auth = {
    cookies_count: cookies.length,
    has_session: cookies.some((c) => /sess|token|auth|login|user|sid/i.test(c.name)),
    session_cookies: cookies
      .filter((c) => /sess|token|auth|login|user|sid/i.test(c.name))
      .map((c) => c.name)
      .slice(0, 10),
    storage_keys: (analysis.storage_keys as string[]) || [],
  };

  const strategies = recommendStrategies(analysis, url);

  // Find similar taps as reference (few-shot context for AI)
  let similar_taps: Array<{ site: string; name: string; strategy: string; code: string; description: string; hint: string }> = [];
  let existing_taps: Array<{ site: string; name: string; description: string }> = [];
  if (tapDirs && tapDirs.length > 0) {
    try {
      const allTaps = await listTaps(tapDirs);
      similar_taps = findSimilarTaps(url, strategies, allTaps);
      existing_taps = findExistingTaps(url, allTaps);
    } catch { /* non-critical */ }
  }

  return {
    url,
    framework: analysis.framework,
    ssr_state: analysis.ssr_state,
    api_hints: analysis.api_hints,
    interactive: analysis.interactive,
    auth,
    meta: analysis.meta,
    strategies,
    existing_taps,
    similar_taps,
  };
}

// --- Meta-Forge: iterative search prompt ---

import { readHistory } from "./history.ts";

/** Build a prompt for Meta-Forge proposer with full history context. */
export async function buildMetaForgePrompt(
  site: string,
  name: string,
  description: string,
): Promise<string> {
  const history = await readHistory(site, name);

  let historyContext = "";
  if (history.length > 0) {
    const lines = history.map(v => {
      const score = v.score as Record<string, unknown> | undefined;
      const rate = score?.success_rate ?? "?";
      const latency = score?.avg_latency_ms ?? "?";
      return `  ${v.version}: success_rate=${rate}, latency=${latency}ms, traces=${v.traceCount}`;
    });
    historyContext = `
## Prior Versions
${lines.join("\n")}

Read the full history at ~/.tap/history/${site}/${name}/ — each version directory contains:
- tap.js (source code)
- score.json (evaluation metrics)
- traces/ (step-by-step execution traces with timing and errors)

Use \`cat\`, \`grep\`, \`diff\` to inspect prior versions and traces.
Identify which steps failed, why, and what strategies worked in prior versions.
`;
  } else {
    historyContext = `
## No Prior History
This is the first forge attempt. Start with forge.inspect to discover the interface.
`;
  }

  return `# Meta-Forge: Iteratively Improve ${site}/${name}

## Goal
${description}

## Search Process
1. Read prior history (if any) — understand what worked and what failed
2. Use forge.inspect to (re-)discover the target interface
3. Propose a new tap strategy based on history + inspection
4. Use forge.verify to test the strategy
5. Use forge.save to persist if it works
6. The system will automatically archive the version and collect traces

${historyContext}
## Tap Format
\`\`\`javascript
export default {
  site: "${site}",
  name: "${name}",
  runtime: "extension" | "macos" | "playwright",
  app: "AppName",  // macOS only
  columns: ["col1", "col2"],
  args: { key: { type: "string", required: true } },
  health: { min_rows: 1, non_empty: ["col1"] },
  async run(page, args) {
    // Your automation strategy here
    return [{ col1: "value", col2: "value" }];
  }
}
\`\`\`

## Strategy Preference (highest to lowest stability)
1. API (page.fetch) — most stable, fastest
2. SSR State (page.ssrState) — stable, no interaction needed
3. Semantic targeting (page.click("text"), page.find("label")) — cross-version stable
4. DOM selectors (page.eval with querySelector) — may break on redesign
5. Coordinates (page.pointer) — last resort, breaks on resize

## Constraints
- Every tap MUST have a health contract (min_rows, non_empty)
- Prefer fewer, larger page.eval calls over many small ones (reduces focus-switching on macOS)
- Test with at least 2 different inputs via forge.verify before forge.save
`;
}

