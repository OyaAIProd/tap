/**
 * Bridge client — WebSocket connection to daemon with ID-based response routing.
 * Used by both CLI and MCP to talk to the daemon.
 */

import { EXTENSION_PORT, CLIENT_PORT, startDaemon } from "./daemon.ts";

type Resolver = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

export class BridgeClient {
  private ws: WebSocket;
  private pending = new Map<number, Resolver>();
  private nextId = 1;
  private ready: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("connection failed"));
    });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result);
        }
      }
    };
  }

  async waitReady(): Promise<void> {
    await this.ready;
  }

  /** Send a tap protocol envelope and wait for response. */
  sendTap(
    type: string,
    method: string,
    params: Record<string, unknown> = {},
    tabId = -1,
    timeoutMs = 60000,
  ): Promise<unknown> {
    const id = this.nextId++;
    const envelope: Record<string, unknown> = {
      protocol: "tap/1.0",
      id,
      type,
      method,
      params,
    };
    if (tabId >= 0) envelope.tabId = tabId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${type}/${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify(envelope));
    });
  }

  /** Send legacy JSON-RPC (for backward compat with extension). */
  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method };
    if (params) msg.params = params;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** Connect to daemon, auto-start if not running. */
export async function connectToDaemon(): Promise<BridgeClient> {
  const url = `ws://127.0.0.1:${CLIENT_PORT}`;

  // Try existing daemon
  try {
    const client = new BridgeClient(url);
    await client.waitReady();
    return client;
  } catch {
    // No daemon running
  }

  // Fork daemon
  console.error("bridge: no daemon running, starting...");
  await forkDaemon();

  // Retry connection
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const client = new BridgeClient(url);
      await client.waitReady();
      console.error("bridge: connected to daemon");
      return client;
    } catch {
      // Keep trying
    }
  }

  throw new Error("daemon did not start within 5 seconds");
}

async function forkDaemon(): Promise<void> {
  const exe = Deno.execPath();
  const script = new URL("./cli.ts", import.meta.url).pathname;
  const cmd = new Deno.Command(exe, {
    args: ["run", "--allow-all", "--no-check", script, "daemon"],
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  });
  const child = cmd.spawn();
  // Detach — don't wait for it
  child.unref();
  // Give it a moment to start
  await new Promise((r) => setTimeout(r, 500));
}

/** Check if daemon is running by trying to connect. */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const client = new BridgeClient(`ws://127.0.0.1:${CLIENT_PORT}`);
    await client.waitReady();
    client.close();
    return true;
  } catch {
    return false;
  }
}
