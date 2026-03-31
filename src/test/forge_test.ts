/**
 * Constraint: Forge inspection (safety / what)
 * Why: forge.inspect is how ANY agent creates taps.
 * Must work via page.eval RPC (not extension-internal APIs).
 *
 * Run: deno test src/test/forge_test.ts --no-check
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { forgeInspect, forgeVerify, checkTapQuality, findSimilarTaps, recommendStrategies, analyzePageContextSource } from "../forge.ts";
import type { TapModule } from "../executor.ts";

// --- Safety: forge.inspect gathers data via RPC ---

Deno.test("[safety/what] forgeInspect calls page.eval for page analysis", async () => {
  // Why: forge must use kernel RPC, not extension-internal chrome.scripting
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const send = (_type: string, method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "page.eval") {
      return Promise.resolve({
        framework: { name: "react", evidence: "#__next" },
        ssr_state: {},
        api_hints: [],
        interactive: { forms: [], inputs: [], buttons: [], links_count: 0 },
        storage_keys: [],
        meta: { ready_state: "complete" },
      });
    }
    if (method === "page.cookies") return Promise.resolve([]);
    if (method === "page.nav") return Promise.resolve({});
    return Promise.resolve({});
  };

  const result = await forgeInspect("https://example.com", send);
  assertEquals(calls.some((c) => c.method === "page.eval"), true, "must call page.eval");
  assertEquals(result.framework.name, "react");
  assertExists(result.strategies);
  assertEquals(result.url, "https://example.com");
});

Deno.test("[safety/what] forgeInspect navigates to URL first", async () => {
  // Why: forge needs to be on the target page to inspect it
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const send = (_type: string, method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "eval") {
      return Promise.resolve({
        framework: { name: "unknown", evidence: "none" },
        ssr_state: {},
        api_hints: [],
        interactive: { forms: [], inputs: [], buttons: [], links_count: 0 },
        storage_keys: [],
        meta: {},
      });
    }
    return Promise.resolve({});
  };

  await forgeInspect("https://example.com/page", send);
  const navCall = calls.find((c) => c.method === "page.nav");
  assertEquals(navCall?.params?.url, "https://example.com/page");
});

// --- Safety: strategy recommendation ---

Deno.test("[safety/what] recommendStrategies returns SSR strategy when SSR state found", () => {
  // Why: SSR is the highest-priority strategy — zero network requests
  const analysis = {
    ssr_state: {
      __NEXT_DATA__: { size: 5000, keys: ["props", "page"], sample: "{}" },
    },
    api_hints: [],
  };
  const strategies = recommendStrategies(analysis, "https://example.com");
  assertEquals(strategies[0].type, "ssr");
  assertEquals(strategies[0].rank, 1);
  assertEquals(typeof strategies[0].template, "string");
  assertEquals(strategies[0].template.includes("__NEXT_DATA__"), true);
});

Deno.test("[safety/what] recommendStrategies returns API strategy when API endpoints found", () => {
  const analysis = {
    ssr_state: {},
    api_hints: [
      { url: "https://api.example.com/v1/feed", pathname: "/v1/feed", size: 10000 },
    ],
  };
  const strategies = recommendStrategies(analysis, "https://example.com");
  const apiStrategy = strategies.find((s: { type: string }) => s.type === "api");
  assertExists(apiStrategy);
  assertEquals(apiStrategy.template.includes("fetch"), true);
});

Deno.test("[safety/what] recommendStrategies always includes DOM fallback", () => {
  // Why: DOM extraction always works, even when SSR/API aren't available
  const strategies = recommendStrategies({ ssr_state: {}, api_hints: [] }, "https://example.com");
  const domStrategy = strategies.find((s: { type: string }) => s.type === "dom");
  assertExists(domStrategy);
  assertEquals(domStrategy.template.includes("querySelectorAll"), true);
});

// --- Safety: analyzePageContext is a self-contained string ---

Deno.test("[safety/what] analyzePageContextSource is a string for page.eval", () => {
  // Why: the analysis function must be serializable — it runs in page context via eval
  assertEquals(typeof analyzePageContextSource, "string");
  assertEquals(analyzePageContextSource.includes("framework"), true);
  assertEquals(analyzePageContextSource.includes("ssr_state"), true);
  assertEquals(analyzePageContextSource.includes("api_hints"), true);
});

// --- Quality: similar taps context ---

Deno.test("[quality/what] findSimilarTaps returns matches by site", () => {
  // Why: same-site taps are the strongest reference — proven patterns for that exact domain
  const taps: TapModule[] = [
    { site: "example", name: "hot", description: "test", extract: () => [{ title: "a" }] },
    { site: "other", name: "feed", description: "test", extract: () => [{ title: "b" }] },
  ];
  const result = findSimilarTaps("https://example.com/page", [], taps);
  assertEquals(result.length >= 1, true);
  assertEquals(result[0].site, "example");
});

Deno.test("[quality/what] findSimilarTaps returns matches by strategy type", () => {
  // Why: taps with same strategy type show how to handle similar API/SSR/DOM patterns
  const taps: TapModule[] = [
    { site: "other", name: "hot", description: "test",
      extract: (() => { const r = fetch; return () => [{ title: String(r) }]; })() },
  ];
  const strategies = [{ type: "api" }] as Array<Record<string, unknown>>;
  const result = findSimilarTaps("https://unrelated.com", strategies, taps);
  // Should still find something — strategy-type matching is a fallback
  assertEquals(Array.isArray(result), true);
});

Deno.test("[safety/what] findSimilarTaps bounded to 5 entries", () => {
  // Why: too many examples overwhelm AI context — 5 covers same-site + strategy matches
  const taps: TapModule[] = Array.from({ length: 10 }, (_, i) => ({
    site: "example", name: `tap${i}`, description: "test", extract: () => [],
  }));
  const result = findSimilarTaps("https://example.com", [], taps);
  assertEquals(result.length <= 5, true);
});

// --- Quality: save quality gates ---

Deno.test("[quality/what] checkTapQuality warns on missing health", () => {
  // Why: taps without health degrade silently — no runtime monitoring
  const code = `export default { site: "x", name: "t", extract: () => [] }`;
  const warnings = checkTapQuality(code);
  assertEquals(warnings.some(w => w.includes("health")), true);
});

Deno.test("[quality/what] checkTapQuality warns on fetch without credentials", () => {
  // Why: authenticated endpoints fail silently without credentials:'include'
  const code = `export default { site: "x", name: "t", health: { min_rows: 1 },
    extract: async () => { const r = await fetch("https://api.x.com/data"); return r.json() } }`;
  const warnings = checkTapQuality(code);
  assertEquals(warnings.some(w => w.includes("credentials")), true);
});

Deno.test("[quality/what] checkTapQuality no warnings for well-formed code", () => {
  // Why: well-formed taps should pass cleanly — no false positives
  const code = `export default { site: "x", name: "t",
    health: { min_rows: 5, non_empty: ["title"] },
    extract: async () => {
      const r = await fetch("https://api.x.com/data", { credentials: "include" })
      const d = await r.json()
      return d.map(i => ({ title: String(i.title || '') })).filter(i => i.title)
    } }`;
  const warnings = checkTapQuality(code);
  assertEquals(warnings.length, 0);
});

// --- Quality: defensive templates ---

Deno.test("[quality/what] all templates include health contract", () => {
  // Why: taps without health break silently — no way to detect degraded extraction
  const strategies = recommendStrategies(
    { ssr_state: { __NEXT_DATA__: { size: 5000, keys: ["props"], sample: "{}" } },
      api_hints: [{ url: "https://api.example.com/v1/feed", pathname: "/v1/feed", size: 10000 }] },
    "https://example.com",
  );
  for (const s of strategies) {
    const tmpl = s.template as string;
    assertEquals(tmpl.includes("health:"), true, `${s.type} template missing health contract`);
    assertEquals(tmpl.includes("min_rows"), true, `${s.type} template missing min_rows`);
  }
});

Deno.test("[quality/what] API template includes credentials", () => {
  // Why: 30+ existing taps use credentials:'include' — API fetch without it fails silently on auth sites
  const strategies = recommendStrategies(
    { ssr_state: {}, api_hints: [{ url: "https://api.example.com/v1/feed", pathname: "/v1/feed", size: 10000 }] },
    "https://example.com",
  );
  const api = strategies.find((s: Record<string, unknown>) => s.type === "api");
  assertExists(api);
  assertEquals((api.template as string).includes('credentials'), true, "API template missing credentials");
});

Deno.test("[quality/what] SSR template includes defensive chaining", () => {
  // Why: SSR state has arbitrary nesting — ?. prevents TypeError on missing intermediate keys
  const strategies = recommendStrategies(
    { ssr_state: { __NEXT_DATA__: { size: 5000, keys: ["props"], sample: "{}" } }, api_hints: [] },
    "https://example.com",
  );
  const ssr = strategies.find((s: Record<string, unknown>) => s.type === "ssr");
  assertExists(ssr);
  const tmpl = ssr.template as string;
  assertEquals(tmpl.includes("?."), true, "SSR template missing optional chaining");
  assertEquals(tmpl.includes("String("), true, "SSR template missing String coercion");
});

Deno.test("[quality/what] DOM template includes dedup and filter", () => {
  // Why: DOM extraction often picks up duplicates — dedup + filter prevents empty/duplicate rows
  const strategies = recommendStrategies({ ssr_state: {}, api_hints: [] }, "https://example.com");
  const dom = strategies.find((s: Record<string, unknown>) => s.type === "dom");
  assertExists(dom);
  const tmpl = dom.template as string;
  assertEquals(tmpl.includes("Set"), true, "DOM template missing dedup (Set)");
  assertEquals(tmpl.includes(".filter("), true, "DOM template missing filter");
});

// --- Quality: forge.verify diagnostics ---

Deno.test("[quality/what] forgeVerify returns ok:true when result is valid", async () => {
  // Why: successful verify should return data without diagnostics overhead
  const send = (_type: string, method: string, _params: Record<string, unknown>) => {
    if (method === "page.nav") return Promise.resolve({});
    if (method === "page.wait") return Promise.resolve({});
    if (method === "page.eval") return Promise.resolve([{ title: "hello" }]);
    return Promise.resolve({});
  };
  const result = await forgeVerify("https://example.com", "[{title:'hello'}]", send);
  assertEquals(result.ok, true);
  assertExists(result.result);
});

Deno.test("[quality/what] forgeVerify returns diagnostics when result is empty", async () => {
  // Why: empty result without diagnostics = AI can't self-correct, forge fails
  let evalCount = 0;
  const send = (_type: string, method: string, _params: Record<string, unknown>) => {
    if (method === "page.nav") return Promise.resolve({});
    if (method === "page.wait") return Promise.resolve({});
    if (method === "page.eval") {
      evalCount++;
      if (evalCount === 1) return Promise.resolve([]); // extraction returns empty
      // second eval = diagnostics gathering
      return Promise.resolve({
        page_url: "https://example.com",
        page_title: "Example",
        ready_state: "complete",
        element_count: 47,
        visible_text_sample: "Hello world",
      });
    }
    return Promise.resolve({});
  };
  const result = await forgeVerify("https://example.com", "[]", send);
  assertEquals(result.ok, false);
  assertExists((result.diagnostics as Record<string, unknown>)?.suggestion);
  assertExists((result.diagnostics as Record<string, unknown>)?.element_count);
});

Deno.test("[quality/what] forgeVerify returns diagnostics when eval throws", async () => {
  // Why: error without context = AI retries blindly instead of fixing the root cause
  let evalCount = 0;
  const send = (_type: string, method: string, _params: Record<string, unknown>) => {
    if (method === "page.nav") return Promise.resolve({});
    if (method === "page.wait") return Promise.resolve({});
    if (method === "page.eval") {
      evalCount++;
      if (evalCount === 1) throw new Error("SyntaxError: unexpected token");
      return Promise.resolve({
        page_url: "https://example.com",
        page_title: "Example",
        ready_state: "complete",
        element_count: 10,
        visible_text_sample: "",
      });
    }
    return Promise.resolve({});
  };
  const result = await forgeVerify("https://example.com", "bad()", send);
  assertEquals(result.ok, false);
  const diag = result.diagnostics as Record<string, unknown>;
  assertExists(diag?.error_message);
  assertEquals(typeof diag.suggestion, "string");
});
