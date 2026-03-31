/**
 * Tap executor — dynamic loading + execution of .tap.js files.
 *
 * Replaces extension/protocol/executor.js. Taps are loaded via dynamic
 * import() from disk, executed with a page proxy, results normalized.
 */

import { createPageProxy, type RpcSend } from "./page.ts";

export interface TapArgSpec {
  type: string;
  default?: unknown;
  required?: boolean;
  maxLength?: number;
  description?: string;
}

export interface TapHealthContract {
  min_rows?: number;
  non_empty?: string[];
}

export interface TapModule {
  site: string;
  name: string;
  description: string;
  runtime?: "extension" | "playwright" | "macos";
  app?: string;
  columns?: string[];
  args?: Record<string, TapArgSpec>;
  health?: TapHealthContract;
  run?: (page: unknown, args: Record<string, unknown>) => Promise<unknown[]>;
  cleanup?: (page: unknown) => Promise<void>;
  url?: string | ((args: Record<string, unknown>) => string);
  extract?: (args: Record<string, unknown>) => unknown[];
  transform?: (rows: Record<string, unknown>[], args: Record<string, unknown>) => unknown[];
  waitFor?: string;
  timeout?: number;
}

export interface TapResult {
  columns: string[];
  rows: Record<string, string>[];
  rawRows: Record<string, unknown>[];
  count: number;
  timing: {
    run_ms?: number;
    total_ms: number;
  };
}

/** Load a single .tap.js from disk via dynamic import. */
export async function loadTap(path: string): Promise<TapModule> {
  // Convert to file:// URL for Deno import
  const base = path.startsWith("file://") ? path : `file://${path}`;
  // Cache-bust with mtime so tap edits are picked up without daemon restart
  const stat = await Deno.stat(path).catch(() => null);
  const mtime = stat?.mtime?.getTime() ?? Date.now();
  const url = `${base}?t=${mtime}`;
  const mod = await import(url);
  const tap = mod.default;
  if (!tap || !tap.site || !tap.name) {
    throw new Error(`Invalid tap at ${path}: missing site or name`);
  }
  return tap as TapModule;
}

/** Discover all .tap.js files in directories.
 *  Dirs are searched in order — first match wins (user taps override skills). */
export async function listTaps(dirs: string[]): Promise<TapModule[]> {
  const seen = new Set<string>();
  const taps: TapModule[] = [];
  for (const dir of dirs) {
    try {
      for await (const siteEntry of Deno.readDir(dir)) {
        if (!siteEntry.isDirectory) continue;
        const sitePath = `${dir}/${siteEntry.name}`;
        for await (const fileEntry of Deno.readDir(sitePath)) {
          if (!fileEntry.name.endsWith(".tap.js")) continue;
          try {
            const tap = await loadTap(`${sitePath}/${fileEntry.name}`);
            const key = `${tap.site}/${tap.name}`;
            if (seen.has(key)) continue; // user tap already registered
            seen.add(key);
            taps.push(tap);
          } catch {
            // Skip invalid taps
          }
        }
      }
    } catch {
      // Skip missing directories
    }
  }
  return taps.sort((a, b) =>
    `${a.site}/${a.name}`.localeCompare(`${b.site}/${b.name}`)
  );
}

/** Append a log entry to ~/.tap/logs/tap.jsonl */
export async function appendLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const home = Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`;
    const dir = `${home}/logs`;
    await Deno.mkdir(dir, { recursive: true }).catch(() => {});
    const line = JSON.stringify({ ...entry, ts: Date.now() }) + "\n";
    await Deno.writeTextFile(`${dir}/tap.jsonl`, line, { append: true });
  } catch { /* logging must never break execution */ }
}

/** Run a tap with a page proxy, normalize results. */
export async function runTap(
  tap: TapModule,
  args: Record<string, unknown>,
  send: RpcSend,
  tapDirs?: string[],
  opts?: { sessionId?: string },
): Promise<TapResult> {
  // L1 optimization: auto-batch consecutive eval calls into evalBatch RPC.
  // Why: eval is ~80% of operations. For loop-heavy taps (e.g., extracting 100 items,
  // each needing 3 evals), N consecutive evals without dependencies should batch
  // into 1 RPC, reducing round-trips by 50-80% and improving latency significantly.
  // This is transparent to tap code — tap authors don't need to change anything.
  // Design: intercept send() calls, buffer eval calls, flush on non-eval RPC or timeout.

  // Track tabId from nav responses so all subsequent calls target the same tab
  let sessionTabId: number | undefined;

  /** Wrap raw send to auto-attach sessionTabId */
  const tabSend: RpcSend = async (type: string, method: string, params: Record<string, unknown>) => {
    if (sessionTabId !== undefined && !("tabId" in params)) {
      params = { ...params, tabId: sessionTabId };
    }
    const result = await send(type, method, params);
    // Capture tabId from nav response
    if (method === "page.nav" && result && typeof result === "object" && "tabId" in (result as Record<string, unknown>)) {
      sessionTabId = (result as Record<string, unknown>).tabId as number;
    }
    return result;
  };

  const evalBuffer: { expr: string; resolve: (val: unknown) => void }[] = [];
  let flushTimer: number | undefined;
  let flushScheduled = false;

  const flushEvalBuffer = async () => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flushScheduled = false;
    if (evalBuffer.length === 0) return;

    const batch = evalBuffer.splice(0);
    const expressions = batch.map(e => e.expr);
    const results = ((await tabSend("tool", "page.evalBatch", { expressions })) || []) as unknown[];

    // Resolve each pending eval with its result
    batch.forEach((item, i) => {
      item.resolve(results?.[i]);
    });
  };

  const scheduleFlush = () => {
    if (flushScheduled) return; // Already scheduled
    flushScheduled = true;
    // Use microtask: defer flush until next microtask checkpoint.
    // This allows sync eval calls in tight loops to batch together.
    Promise.resolve().then(() => {
      // If nothing has flushed yet, schedule macrotask flush with timeout
      if (flushScheduled && evalBuffer.length > 0) {
        flushTimer = setTimeout(flushEvalBuffer, 10) as unknown as number;
      }
    });
  };

  const wrappedSend: RpcSend = async (type: string, method: string, params: Record<string, unknown>) => {
    // Intercept page.eval — add to buffer instead of sending immediately
    if (method === "page.eval") {
      return new Promise((resolve) => {
        const expr = params.expression as string;
        evalBuffer.push({ expr, resolve });
        scheduleFlush();
      });
    }

    // All non-eval RPCs flush the buffer first
    await flushEvalBuffer();
    return tabSend(type, method, params);
  };

  const page = createPageProxy(wrappedSend);
  const start = performance.now();

  // Wire page.tap() for composition — load sub-taps from disk, run locally
  if (tapDirs) {
    page.tap = async (site: string, name: string, subArgs: Record<string, unknown> = {}) => {
      let tapPath = "";
      for (const dir of tapDirs) {
        const p = `${dir}/${site}/${name}.tap.js`;
        try { await Deno.stat(p); tapPath = p; break; } catch { /* next */ }
      }
      if (!tapPath) throw new Error(`tap not found: ${site}/${name}`);
      const subTap = await loadTap(tapPath);
      const result = await runTap(subTap, subArgs, send, tapDirs);
      return result.rows;
    };
  }

  // Resolve args with defaults + validate constraints
  const resolvedArgs: Record<string, unknown> = { ...args };
  if (tap.args) {
    for (const [key, spec] of Object.entries(tap.args)) {
      if (resolvedArgs[key] === undefined && spec.default !== undefined) {
        resolvedArgs[key] = spec.default;
      }
      // Validate required
      if (spec.required && (resolvedArgs[key] === undefined || resolvedArgs[key] === '')) {
        throw new Error(`${tap.site}/${tap.name}: required arg "${key}" is missing`);
      }
      // Validate maxLength
      if (spec.maxLength && typeof resolvedArgs[key] === 'string') {
        const val = resolvedArgs[key] as string;
        if (val.length > spec.maxLength) {
          throw new Error(
            `${tap.site}/${tap.name}: arg "${key}" is ${val.length} chars, max ${spec.maxLength}`
          );
        }
      }
    }
  }

  let rawRows: unknown[];
  try {
    if (tap.run) {
      rawRows = (await tap.run(page, resolvedArgs)) as unknown[];
    } else if (tap.extract) {
      // Extract format: nav → waitFor → eval(extract) → limit
      const navUrl = typeof tap.url === "function" ? tap.url(resolvedArgs) : tap.url;
      if (navUrl) await page.nav(navUrl);
      if (tap.waitFor) await page.waitFor(tap.waitFor);
      const expr = `(${tap.extract.toString()})(${JSON.stringify(resolvedArgs)})`;
      rawRows = (await page.eval(expr)) as unknown[];
      // Ensure rawRows is array before slicing
      if (!Array.isArray(rawRows)) {
        rawRows = rawRows ? [rawRows] : [];
      }
      if (resolvedArgs.limit) {
        rawRows = rawRows.slice(0, resolvedArgs.limit as number);
      }
    } else if (tap.transform) {
      // Transform format: receive rows → process → emit rows (data pipeline)
      const inputRows = (resolvedArgs.rows || []) as Record<string, unknown>[];
      rawRows = tap.transform(inputRows, resolvedArgs) as unknown[];
      if (!Array.isArray(rawRows)) {
        rawRows = rawRows ? [rawRows] : [];
      }
    } else {
      throw new Error(`Tap ${tap.site}/${tap.name} must have run(), extract(), or transform()`);
    }
  } catch (e) {
    // Run cleanup even on error — guaranteed lifecycle
    if (tap.cleanup) {
      try { await tap.cleanup(page); } catch { /* cleanup must not break execution */ }
    }
    // Flush any buffered evals even on error
    await flushEvalBuffer().catch(() => {});
    const totalMs = Math.round(performance.now() - start);
    await appendLog({
      event: "run", site: tap.site, name: tap.name,
      ms: totalMs, rows: 0, error: String(e),
      ...(opts?.sessionId && { sid: opts.sessionId }),
    });
    throw e;
  }

  // Run cleanup on success — guaranteed lifecycle
  if (tap.cleanup) {
    try { await tap.cleanup(page); } catch { /* cleanup must not break execution */ }
  }

  const totalMs = Math.round(performance.now() - start);

  // Flush any remaining buffered evals before returning
  await flushEvalBuffer();

  // Ensure array
  if (!Array.isArray(rawRows)) {
    rawRows = rawRows ? [rawRows] : [];
  }

  // Preserve raw rows (original types) for pipeline composition
  const typedRows = rawRows.map((row) => {
    if (row && typeof row === "object") return { ...row as Record<string, unknown> };
    return {};
  });

  // Normalize rows: all values to strings (for display / LLM consumption)
  const rows = rawRows.map((row) => {
    const normalized: Record<string, string> = {};
    if (row && typeof row === "object") {
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        normalized[k] = v == null ? "" : String(v);
      }
    }
    return normalized;
  });

  // Infer columns from first row if not declared
  const columns = tap.columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []);

  await appendLog({
    event: "run", site: tap.site, name: tap.name,
    ms: totalMs, rows: rows.length,
    ...(opts?.sessionId && { sid: opts.sessionId }),
  });

  return {
    columns,
    rows,
    rawRows: typedRows,
    count: rows.length,
    timing: { run_ms: totalMs, total_ms: totalMs },
  };
}
