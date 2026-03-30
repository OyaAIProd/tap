/**
 * Forge — tap creation pipeline (Deno-side).
 *
 * Replaces extension/protocol/forge.js. Page analysis runs via page.eval RPC,
 * strategy recommendation runs locally. No extension-internal APIs needed.
 */

import { type RpcSend } from "./page.ts";

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
  extract: () => {
    const state = window.${primaryGlobal}
    // Keys: ${topKeys}
    const items = Array.isArray(state) ? state : Object.values(state)
    return items.map(item => ({ /* TODO */ }))
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
  extract: async () => {
    const res = await fetch("${bestAPI.url}", { credentials: "include" })
    const data = await res.json()
    return data.map(item => ({ /* TODO */ }))
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
  extract: () => {
    return Array.from(document.querySelectorAll("TODO_selector"))
      .map(el => ({ /* TODO */ }))
  }
}`,
  });

  return strategies;
}

/**
 * Inspect a page for tap forging. Gathers data via page.eval RPC,
 * then recommends strategies locally.
 */
export async function forgeInspect(
  url: string,
  send: RpcSend,
): Promise<Record<string, unknown>> {
  // Navigate to target page
  if (url) {
    await send("tool", "nav", { url });
  }

  // Gather page analysis via eval (runs in page context)
  const analysis = (await send("tool", "eval", {
    expression: analyzePageContextSource,
  })) as Record<string, unknown>;

  // Get cookies for auth detection
  let cookies: Array<Record<string, string>> = [];
  try {
    const raw = await send("tool", "cookies", {});
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

  return {
    url,
    framework: analysis.framework,
    ssr_state: analysis.ssr_state,
    api_hints: analysis.api_hints,
    interactive: analysis.interactive,
    auth,
    meta: analysis.meta,
    strategies,
  };
}
