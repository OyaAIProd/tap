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
import { forgeInspect, recommendStrategies, analyzePageContextSource } from "../forge.ts";

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
