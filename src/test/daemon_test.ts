/**
 * Constraint: Daemon relay (safety / what)
 * Why: daemon is the ONLY path between clients (CLI/MCP) and extension.
 * Wrong relay = commands lost, responses misrouted, silent failures.
 *
 * Run: deno test deno/test/daemon_test.ts --allow-net
 */

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLIENT_PORT,
  EXTENSION_PORT,
  startDaemon,
} from "../daemon.ts";

// --- Safety: port configuration ---

Deno.test("[safety/what] daemon extension port is 9333", () => {
  // Why: extension hardcodes ws://127.0.0.1:9333 — port mismatch = no connection
  assertEquals(EXTENSION_PORT, 9333);
});

Deno.test("[safety/what] daemon client port is 9334", () => {
  // Why: CLI and MCP connect here — must be distinct from extension port
  assertEquals(CLIENT_PORT, 9334);
});

Deno.test("[safety/what] extension and client ports are different", () => {
  // Why: same port would mix extension and client connections
  assertNotEquals(EXTENSION_PORT, CLIENT_PORT);
});

// --- Safety: message relay ---

Deno.test("[safety/what] daemon relays client message to extension and back", async () => {
  // Why: this IS the daemon's entire job — relay must be lossless
  const { stop, extensionPort, clientPort } = await startDaemon({
    extensionPort: 0, // random port
    clientPort: 0, // random port
  });

  try {
    // Fake extension: accept messages, echo result
    const ext = new WebSocket(`ws://127.0.0.1:${extensionPort}`);
    await new Promise<void>((r) => (ext.onopen = () => r()));
    ext.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      ext.send(JSON.stringify({ id: msg.id, result: { pong: true } }));
    };

    // Client connects and sends a request
    const client = new WebSocket(`ws://127.0.0.1:${clientPort}`);
    await new Promise<void>((r) => (client.onopen = () => r()));

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      client.onmessage = (e) => resolve(JSON.parse(e.data));
      client.send(JSON.stringify({ id: 1, method: "test", params: {} }));
    });

    assertEquals(response.id, 1);
    assertEquals((response.result as Record<string, unknown>)?.pong, true);

    ext.close();
    client.close();
  } finally {
    await stop();
  }
});

Deno.test("[safety/what] daemon rewrites IDs to prevent collision between clients", async () => {
  // Why: two clients can both send id:1 — daemon must disambiguate
  const { stop, extensionPort, clientPort } = await startDaemon({
    extensionPort: 0,
    clientPort: 0,
  });

  try {
    // Fake extension: track received IDs, echo with unique marker
    const receivedIds: number[] = [];
    const ext = new WebSocket(`ws://127.0.0.1:${extensionPort}`);
    await new Promise<void>((r) => (ext.onopen = () => r()));
    ext.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      receivedIds.push(msg.id);
      ext.send(
        JSON.stringify({ id: msg.id, result: { from: `ext-${msg.id}` } }),
      );
    };

    // Two clients both send id:1
    const c1 = new WebSocket(`ws://127.0.0.1:${clientPort}`);
    const c2 = new WebSocket(`ws://127.0.0.1:${clientPort}`);
    await Promise.all([
      new Promise<void>((r) => (c1.onopen = () => r())),
      new Promise<void>((r) => (c2.onopen = () => r())),
    ]);

    const [r1, r2] = await Promise.all([
      new Promise<Record<string, unknown>>((resolve) => {
        c1.onmessage = (e) => resolve(JSON.parse(e.data));
        c1.send(JSON.stringify({ id: 1, method: "a", params: {} }));
      }),
      new Promise<Record<string, unknown>>((resolve) => {
        c2.onmessage = (e) => resolve(JSON.parse(e.data));
        c2.send(JSON.stringify({ id: 1, method: "b", params: {} }));
      }),
    ]);

    // Both clients should get back id:1 (their original IDs restored)
    assertEquals(r1.id, 1);
    assertEquals(r2.id, 1);
    // But daemon sent different IDs to extension
    assertNotEquals(receivedIds[0], receivedIds[1]);

    c1.close();
    c2.close();
    ext.close();
  } finally {
    await stop();
  }
});

Deno.test("[safety/what] daemon returns error when extension not connected", async () => {
  // Why: clear error beats hanging forever — client must know extension is down
  const { stop, clientPort } = await startDaemon({
    extensionPort: 0,
    clientPort: 0,
  });

  try {
    const client = new WebSocket(`ws://127.0.0.1:${clientPort}`);
    await new Promise<void>((r) => (client.onopen = () => r()));

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      client.onmessage = (e) => resolve(JSON.parse(e.data));
      client.send(JSON.stringify({ id: 1, method: "test", params: {} }));
    });

    assertEquals(response.id, 1);
    assertEquals(typeof (response.error as Record<string, unknown>)?.message, "string");

    client.close();
  } finally {
    await stop();
  }
});
