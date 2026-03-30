/**
 * Constraint: Bridge client (safety / what)
 * Why: bridge is the ONLY client-side connection to daemon.
 * Wrong protocol envelope or response routing = tools silently fail.
 *
 * Run: deno test deno/test/bridge_test.ts --allow-net
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BridgeClient } from "../bridge.ts";
import { startDaemon } from "../daemon.ts";

Deno.test("[safety/what] BridgeClient.sendTap sends tap protocol envelope", async () => {
  // Why: extension dispatches by {protocol, type, method} — wrong envelope = silent failure
  const { stop, extensionPort, clientPort } = await startDaemon({
    extensionPort: 0,
    clientPort: 0,
  });

  try {
    // Fake extension: capture the message it receives
    let received: Record<string, unknown> | null = null;
    const ext = new WebSocket(`ws://127.0.0.1:${extensionPort}`);
    await new Promise<void>((r) => (ext.onopen = () => r()));
    ext.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      received = msg;
      ext.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
    };

    const client = new BridgeClient(`ws://127.0.0.1:${clientPort}`);
    await client.waitReady();
    await client.sendTap("tool", "click", { target: "Login" });

    // Daemon rewrites IDs, but protocol/type/method must pass through
    assertEquals(received!.protocol, "tap/1.0");
    assertEquals(received!.type, "tool");
    assertEquals(received!.method, "click");
    assertEquals((received!.params as Record<string, unknown>)?.target, "Login");

    client.close();
    ext.close();
  } finally {
    await stop();
  }
});

Deno.test("[safety/what] BridgeClient routes responses by ID", async () => {
  // Why: concurrent requests must get their own responses, not each other's
  const { stop, extensionPort, clientPort } = await startDaemon({
    extensionPort: 0,
    clientPort: 0,
  });

  try {
    const ext = new WebSocket(`ws://127.0.0.1:${extensionPort}`);
    await new Promise<void>((r) => (ext.onopen = () => r()));
    ext.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      // Respond with method echo so we can verify routing
      ext.send(JSON.stringify({ id: msg.id, result: { echo: msg.method } }));
    };

    const client = new BridgeClient(`ws://127.0.0.1:${clientPort}`);
    await client.waitReady();

    // Send two concurrent requests
    const [r1, r2] = await Promise.all([
      client.sendTap("tool", "first", {}),
      client.sendTap("tool", "second", {}),
    ]);

    // Each should get its own response
    assertEquals((r1 as Record<string, unknown>).echo, "first");
    assertEquals((r2 as Record<string, unknown>).echo, "second");

    client.close();
    ext.close();
  } finally {
    await stop();
  }
});

Deno.test("[safety/what] BridgeClient rejects on error response", async () => {
  // Why: extension errors must propagate as exceptions, not silent nulls
  const { stop, extensionPort, clientPort } = await startDaemon({
    extensionPort: 0,
    clientPort: 0,
  });

  try {
    const ext = new WebSocket(`ws://127.0.0.1:${extensionPort}`);
    await new Promise<void>((r) => (ext.onopen = () => r()));
    ext.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      ext.send(JSON.stringify({
        id: msg.id,
        error: { code: -32000, message: "tap not found" },
      }));
    };

    const client = new BridgeClient(`ws://127.0.0.1:${clientPort}`);
    await client.waitReady();

    await assertRejects(
      () => client.sendTap("tool", "run", { site: "x", name: "y" }),
      Error,
      "tap not found",
    );

    client.close();
    ext.close();
  } finally {
    await stop();
  }
});
