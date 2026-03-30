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
  run?: (page: unknown, args: Record<string, unknown>) => Promise<unknown[]>;
  url?: string | ((args: Record<string, unknown>) => string);
  extract?: (args: Record<string, unknown>) => unknown[];
  waitFor?: string;
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

/** Discover all .tap.js files in directories. */
export async function listTaps(dirs: string[]): Promise<TapModule[]> {
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

/** Run a tap with a page proxy, normalize results. */
export async function runTap(
  tap: TapModule,
  args: Record<string, unknown>,
  send: RpcSend,
): Promise<TapResult> {
  const page = createPageProxy(send);
  const start = performance.now();

  let rawRows: unknown[];
  if (tap.run) {
    rawRows = (await tap.run(page, args)) as unknown[];
  } else {
    throw new Error(`Tap ${tap.site}/${tap.name} has no run() function`);
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

  return {
    columns,
    rows,
    count: rows.length,
    timing: { run_ms: totalMs, total_ms: totalMs },
    health: tap.health,
  };
}
