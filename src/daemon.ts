/**
 * Daemon — WebSocket relay between extension (:9333) and clients (:9334).
 *
 * The daemon is a dumb multiplexer. It rewrites message IDs to prevent
 * collisions between multiple clients, then forwards to the extension
 * and routes responses back to the correct client.
 */

export const EXTENSION_PORT = 9333;
export const CLIENT_PORT = 9334;

interface PendingRequest {
  clientSend: (msg: string) => void;
  originalId: unknown;
  method: string;
  sentAt: number;
}

interface DaemonHandle {
  stop: () => Promise<void>;
  extensionPort: number;
  clientPort: number;
}

/** Handler for requests initiated by the extension (e.g. tap:// links). */
export type ExtensionRequestHandler = (
  msg: { method: string; params: Record<string, unknown> },
  sendToExtension: (type: string, method: string, params: Record<string, unknown>) => Promise<unknown>,
) => Promise<unknown>;

/** Append a line to the daemon log file. */
function logMsg(direction: string, id: unknown, type: string, method: string, extra = "") {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const line = `${ts} ${direction} id=${id} ${type}/${method}${extra ? " " + extra : ""}`;
  const home = Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`;
  const logPath = `${home}/logs/daemon.log`;
  try {
    Deno.writeTextFileSync(logPath, line + "\n", { append: true });
  } catch { /* ignore write errors */ }
}

export async function startDaemon(
  opts: { extensionPort?: number; clientPort?: number; onExtensionRequest?: ExtensionRequestHandler } = {},
): Promise<DaemonHandle> {
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let extensionWs: WebSocket | null = null;

  // Extension-facing server
  const extServer = Deno.serve(
    { port: opts.extensionPort ?? EXTENSION_PORT, hostname: "127.0.0.1", onListen: () => {} },
    (req) => {
      if (req.headers.get("upgrade") !== "websocket") {
        return new Response("ws only", { status: 400 });
      }
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.onopen = () => {
        extensionWs = socket;
      };
      socket.onmessage = async (e) => {
        const msg = JSON.parse(e.data);
        const id = msg.id;

        // Response to a pending request (from client or daemon-initiated kernel call)
        const req = pending.get(id);
        if (req) {
          pending.delete(id);
          const elapsed = Math.round(performance.now() - req.sentAt);
          const hasError = msg.error ? `err="${msg.error.message || "unknown"}"` : "";
          logMsg("◂ ext→cli", req.originalId, "", req.method, `${elapsed}ms${hasError ? " " + hasError : ""}`);
          msg.id = req.originalId;
          req.clientSend(JSON.stringify(msg));
          return;
        }

        // New request FROM the extension (e.g. tap:// link triggered run)
        if (msg.protocol?.startsWith("tap/") && opts.onExtensionRequest) {
          logMsg("◂ ext→daemon", id, msg.type || "", msg.method || "");
          const sendToExtension = (type: string, method: string, params: Record<string, unknown>): Promise<unknown> => {
            return new Promise((resolve, reject) => {
              if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
                reject(new Error("extension disconnected during execution"));
                return;
              }
              const callId = nextId++;
              pending.set(callId, {
                clientSend: (responseStr: string) => {
                  const response = JSON.parse(responseStr);
                  if (response.error) reject(new Error(response.error.message || "unknown"));
                  else resolve(response.result);
                },
                originalId: callId,
                method: `${type}/${method}`,
                sentAt: performance.now(),
              });
              extensionWs!.send(JSON.stringify({ protocol: "tap/1.0", type, method, params, id: callId }));
            });
          };
          try {
            const result = await opts.onExtensionRequest(
              { method: msg.method, params: msg.params || {} },
              sendToExtension,
            );
            socket.send(JSON.stringify({ id, result: result || {} }));
          } catch (err) {
            socket.send(JSON.stringify({ id, error: { code: -32000, message: (err as Error).message } }));
          }
        }
      };
      socket.onclose = () => {
        if (extensionWs === socket) extensionWs = null;
      };
      return response;
    },
  );

  // Client-facing server
  const cliServer = Deno.serve(
    { port: opts.clientPort ?? CLIENT_PORT, hostname: "127.0.0.1", onListen: () => {} },
    (req) => {
      if (req.headers.get("upgrade") !== "websocket") {
        return new Response("ws only", { status: 400 });
      }
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const originalId = msg.id;
        const msgType = msg.type || "";
        const msgMethod = msg.method || "";

        if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
          logMsg("✕ no-ext", originalId, msgType, msgMethod);
          socket.send(JSON.stringify({
            id: originalId,
            error: { code: -32000, message: "extension not connected" },
          }));
          return;
        }

        // Rewrite ID and forward
        const daemonId = nextId++;
        logMsg("▸ cli→ext", originalId, msgType, msgMethod);
        msg.id = daemonId;
        pending.set(daemonId, {
          clientSend: (m) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(m);
          },
          originalId,
          method: `${msgType}/${msgMethod}`,
          sentAt: performance.now(),
        });
        extensionWs.send(JSON.stringify(msg));
      };
      return response;
    },
  );

  const extAddr = extServer.addr as Deno.NetAddr;
  const cliAddr = cliServer.addr as Deno.NetAddr;

  return {
    extensionPort: extAddr.port,
    clientPort: cliAddr.port,
    stop: async () => {
      await extServer.shutdown();
      await cliServer.shutdown();
    },
  };
}
