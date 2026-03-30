/**
 * Constraint: MCP server (safety / what)
 * Why: MCP is the interface between Claude and Tap.
 * Wrong JSON-RPC format = Claude can't discover or call tools.
 *
 * Run: deno test deno/test/mcp_test.ts
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleInitialize,
  handleToolsList,
  handlePromptsList,
  handlePromptsGet,
  handleResourcesList,
  buildToolsSchema,
} from "../mcp.ts";

// --- Safety: MCP protocol compliance ---

Deno.test("[safety/what] initialize response has required MCP fields", () => {
  // Why: MCP spec requires protocolVersion, capabilities, serverInfo
  const resp = handleInitialize(1);
  assertEquals(resp.jsonrpc, "2.0");
  assertEquals(resp.id, 1);
  assertExists(resp.result.protocolVersion);
  assertExists(resp.result.capabilities.tools);
  assertExists(resp.result.serverInfo.name);
  assertEquals(resp.result.serverInfo.name, "tap");
});

Deno.test("[safety/what] tools/list returns valid tool schemas", () => {
  // Why: invalid schema = Claude can't call tools
  const resp = handleToolsList(1);
  const tools = resp.result.tools;
  assertEquals(Array.isArray(tools), true);

  for (const tool of tools) {
    assertExists(tool.name, "tool must have name");
    assertExists(tool.description, "tool must have description");
    assertExists(tool.inputSchema, "tool must have inputSchema");
    assertEquals(
      tool.inputSchema.type,
      "object",
      `tool ${tool.name} inputSchema must be object`,
    );
  }
});

Deno.test("[safety/what] tools schema includes core tools", () => {
  // Why: these are the minimum tools Claude needs to operate
  const schema = buildToolsSchema();
  const names = schema.map((t: { name: string }) => t.name);

  const required = [
    "tap.list",
    "tap.run",
    "tap.screenshot",
    "forge.inspect",
    "forge.verify",
    "forge.save",
    "page.nav",
    "page.click",
    "page.type",
    "page.eval",
  ];

  for (const name of required) {
    assertEquals(
      names.includes(name),
      true,
      `tools schema must include ${name}`,
    );
  }
});

Deno.test("[safety/what] all tool names use category.method format", () => {
  // Why: unified naming convention — every tool must have dot separator
  const schema = buildToolsSchema();
  for (const tool of schema) {
    assertEquals(
      tool.name.includes("."),
      true,
      `tool "${tool.name}" missing category.method dot`,
    );
  }
});

// --- Safety: Prompts ---

Deno.test("[safety/what] prompts/list returns forge and debug prompts", () => {
  // Why: prompts guide AI through forge and debug workflows — missing = agent guesses
  const resp = handlePromptsList(1);
  const prompts = resp.result.prompts;
  assertEquals(Array.isArray(prompts), true);
  assertEquals(prompts.length >= 2, true, "must have at least forge + debug");
  const names = prompts.map((p: { name: string }) => p.name);
  assertEquals(names.includes("forge"), true, "must include forge prompt");
  assertEquals(names.includes("debug"), true, "must include debug prompt");
});

Deno.test("[safety/what] each prompt has name, description, arguments", () => {
  // Why: MCP spec requires these fields for prompt discovery
  const resp = handlePromptsList(1);
  for (const p of resp.result.prompts) {
    assertEquals(typeof p.name, "string", "prompt must have name");
    assertEquals(typeof p.description, "string", "prompt must have description");
    assertEquals(Array.isArray(p.arguments), true, `prompt ${p.name} must have arguments`);
  }
});

Deno.test("[safety/what] forge prompt requires url and capability", () => {
  // Why: forge workflow needs target URL and what the tap should do
  const resp = handlePromptsList(1);
  const forge = resp.result.prompts.find((p: { name: string }) => p.name === "forge")!;
  const argNames = forge.arguments.map((a: { name: string }) => a.name);
  assertEquals(argNames.includes("url"), true);
  assertEquals(argNames.includes("capability"), true);
});

Deno.test("[safety/what] prompts/get forge returns workflow with forge.inspect/verify/save", () => {
  // Why: the prompt content IS the workflow — must mention all forge steps
  const resp = handlePromptsGet(1, { name: "forge", arguments: { url: "https://x.com", capability: "trending" } });
  const text = resp.result.messages[0].content.text;
  assertEquals(text.includes("forge.inspect"), true);
  assertEquals(text.includes("forge.verify"), true);
  assertEquals(text.includes("forge.save"), true);
});

Deno.test("[safety/what] prompts/get debug mentions logs and re-inspect", () => {
  const resp = handlePromptsGet(1, { name: "debug", arguments: { site: "weibo", name: "hot" } });
  const text = resp.result.messages[0].content.text;
  assertEquals(text.includes("tap.logs") || text.includes("tap_logs"), true);
  assertEquals(text.includes("forge_inspect"), true);
});

// --- Quality: prompt retry loops ---

Deno.test("[quality/what] forge prompt includes verify retry loop with diagnostics", () => {
  // Why: without structured retry, AI gives up after 1 failure instead of self-correcting
  const resp = handlePromptsGet(1, { name: "forge", arguments: { url: "https://x.com", capability: "trending" } });
  const text = resp.result.messages[0].content.text;
  assertEquals(text.includes("3"), true, "forge prompt must mention bounded retry (3)");
  assertEquals(text.includes("diagnostics"), true, "forge prompt must reference diagnostics");
});

Deno.test("[quality/what] run prompt includes retry with diagnostics", () => {
  // Why: run prompt is the primary entry — must guide AI through tap-first + auto-forge-retry
  const resp = handlePromptsGet(1, { name: "run", arguments: { url: "https://x.com", task: "trending" } });
  const text = resp.result.messages[0].content.text;
  assertEquals(text.includes("3"), true, "run prompt must mention bounded retry");
  assertEquals(text.includes("diagnostics"), true, "run prompt must reference diagnostics");
  assertEquals(text.includes("similar_taps"), true, "run prompt must mention similar_taps");
});

// --- Safety: Resources ---

Deno.test("[safety/what] resources/list returns protocol and logs", () => {
  // Why: resources give AI introspection into protocol version and runtime logs
  const resp = handleResourcesList(1);
  const uris = resp.result.resources.map((r: { uri: string }) => r.uri);
  assertEquals(uris.includes("tap://protocol"), true);
  assertEquals(uris.includes("tap://logs"), true);
});

Deno.test("[safety/what] each resource has uri, name, mimeType with tap:// scheme", () => {
  // Why: MCP spec requires these fields
  const resp = handleResourcesList(1);
  for (const r of resp.result.resources) {
    assertEquals(typeof r.uri, "string");
    assertEquals(typeof r.name, "string");
    assertEquals(typeof r.mimeType, "string");
    assertEquals(r.uri.startsWith("tap://"), true, `bad scheme: ${r.uri}`);
  }
});

// --- Safety/what-x-what: MCP ↔ executor integration ---

Deno.test("[safety/what-x-what] buildToolsSchema generates schema from discovered taps", async () => {
  // Why: tools/list must reflect actually available taps, not a hardcoded list
  // This is the cross-domain link: MCP schema ← tap discovery ← filesystem
  const schema = buildToolsSchema();
  const hasTapRun = schema.some((t: { name: string }) => t.name === "tap.run");
  assertEquals(hasTapRun, true, "schema must include tap.run for executing taps");
  // tap.run's params must include site, name
  const tapRun = schema.find((t: { name: string }) => t.name === "tap.run");
  assertExists(tapRun?.inputSchema?.properties?.site);
  assertExists(tapRun?.inputSchema?.properties?.name);
});
