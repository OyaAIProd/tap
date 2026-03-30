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
  if (tap.run) {
    rawRows = (await tap.run(page, resolvedArgs)) as unknown[];
  } else if (tap.extract) {
    // Extract format: nav → waitFor → eval(extract) → limit
    const navUrl = typeof tap.url === "function" ? tap.url(resolvedArgs) : tap.url;
    if (navUrl) await page.nav(navUrl);
    if (tap.waitFor) await page.waitFor(tap.waitFor);
    rawRows = (await page.eval(tap.extract.toString(), resolvedArgs)) as unknown[];
    if (resolvedArgs.limit) {
      rawRows = (rawRows as unknown[]).slice(0, resolvedArgs.limit as number);
    }
  } else {
    throw new Error(`Tap ${tap.site}/${tap.name} must have run() or extract()`);
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
