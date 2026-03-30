/**
 * Tap executor — dynamic loading + execution of .tap.js files.
 *
 * Replaces extension/protocol/executor.js. Taps are loaded via dynamic
 * import() from disk, executed with a page proxy, results normalized.
 */

import { createPageProxy, type RpcSend } from "./page.ts";

export interface TapModule {
  site: string;
  name: string;
  description: string;
  columns?: string[];
  args?: Record<string, { type: string; default?: unknown }>;
  run?: (page: unknown, args: Record<string, unknown>) => Promise<unknown[]>;
  url?: string | ((args: Record<string, unknown>) => string);
  extract?: (args: Record<string, unknown>) => unknown[];
  waitFor?: string;
  timeout?: number;
  health?: { min_rows?: number; non_empty?: string[] };
}

export interface TapResult {
  columns: string[];
  rows: Record<string, string>[];
  count: number;
  timing: {
    run_ms?: number;
    total_ms: number;
  };
  health?: { min_rows?: number; non_empty?: string[] };
}

/** Load a single .tap.js from disk via dynamic import. */
export async function loadTap(path: string): Promise<TapModule> {
  // Convert to file:// URL for Deno import
  const url = path.startsWith("file://") ? path : `file://${path}`;
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
): Promise<TapResult> {
  const page = createPageProxy(send);
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

  // Resolve args with defaults
  const resolvedArgs: Record<string, unknown> = { ...args };
  if (tap.args) {
    for (const [key, spec] of Object.entries(tap.args)) {
      if (resolvedArgs[key] === undefined && spec.default !== undefined) {
        resolvedArgs[key] = spec.default;
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
    } else {
      throw new Error(`Tap ${tap.site}/${tap.name} must have run() or extract()`);
    }
  } catch (e) {
    const totalMs = Math.round(performance.now() - start);
    await appendLog({
      event: "run", site: tap.site, name: tap.name,
      ms: totalMs, rows: 0, health: "error",
      error: String(e),
    });
    throw e;
  }

  const totalMs = Math.round(performance.now() - start);

  // Ensure array
  if (!Array.isArray(rawRows)) {
    rawRows = rawRows ? [rawRows] : [];
  }

  // Normalize rows: all values to strings
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

  // Health check
  const health = tap.health;
  let healthStatus = "none";
  if (health) {
    const minRows = health.min_rows ?? 0;
    const nonEmpty = health.non_empty ?? [];
    const pass = rows.length >= minRows &&
      nonEmpty.every((col) => rows.some((r) => r[col] && r[col].trim() !== ""));
    healthStatus = pass ? "pass" : "fail";
  }

  await appendLog({
    event: "run", site: tap.site, name: tap.name,
    ms: totalMs, rows: rows.length, health: healthStatus,
  });

  return {
    columns,
    rows,
    count: rows.length,
    timing: { run_ms: totalMs, total_ms: totalMs },
    health: tap.health,
  };
}
