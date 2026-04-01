/**
 * History filesystem — stores tap versions, traces, and scores
 * for Meta-Forge iterative search.
 *
 * Structure:
 *   ~/.tap/history/{site}/{name}/
 *     latest/trace-{ts}.json
 *     v001/tap.js + score.json + traces/
 *     best → v002/
 */

import type { TraceStep } from "./executor.ts";

function historyDir(site: string, name: string): string {
  const home = Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`;
  return `${home}/history/${site}/${name}`;
}

/** Save a trace from a tap.run to the latest/ directory. */
export async function saveTrace(
  site: string,
  name: string,
  trace: TraceStep[],
  args: Record<string, unknown>,
): Promise<string> {
  const dir = `${historyDir(site, name)}/latest`;
  await Deno.mkdir(dir, { recursive: true });
  const file = `${dir}/trace-${Date.now()}.json`;
  await Deno.writeTextFile(file, JSON.stringify({ args, trace, ts: Date.now() }, null, 2));

  // Rotate: keep max 50 traces in latest/
  try {
    const entries = [];
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.startsWith("trace-")) entries.push(e.name);
    }
    if (entries.length > 50) {
      entries.sort();
      for (const old of entries.slice(0, entries.length - 50)) {
        await Deno.remove(`${dir}/${old}`).catch(() => {});
      }
    }
  } catch { /* rotation must never break */ }

  return file;
}

/** Create a versioned archive from the current latest/ traces + tap code. */
export async function archiveVersion(
  site: string,
  name: string,
  code: string,
): Promise<string> {
  const base = historyDir(site, name);
  await Deno.mkdir(base, { recursive: true });

  // Find next version number
  let maxVersion = 0;
  try {
    for await (const e of Deno.readDir(base)) {
      const m = e.name.match(/^v(\d+)$/);
      if (m) maxVersion = Math.max(maxVersion, parseInt(m[1]));
    }
  } catch { /* empty dir */ }
  const version = `v${String(maxVersion + 1).padStart(3, "0")}`;
  const vdir = `${base}/${version}`;

  // Create version directory with code
  await Deno.mkdir(`${vdir}/traces`, { recursive: true });
  await Deno.writeTextFile(`${vdir}/tap.js`, code);

  // Move latest/ traces into version
  const latestDir = `${base}/latest`;
  try {
    for await (const e of Deno.readDir(latestDir)) {
      if (e.isFile && e.name.startsWith("trace-")) {
        await Deno.copyFile(`${latestDir}/${e.name}`, `${vdir}/traces/${e.name}`);
        await Deno.remove(`${latestDir}/${e.name}`).catch(() => {});
      }
    }
  } catch { /* no traces yet */ }

  return version;
}

/** Update score.json for a version. */
export async function updateScore(
  site: string,
  name: string,
  version: string,
  score: Record<string, unknown>,
): Promise<void> {
  const dir = version === "latest"
    ? `${historyDir(site, name)}/latest`
    : `${historyDir(site, name)}/${version}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/score.json`, JSON.stringify({ ...score, ts: Date.now() }, null, 2));
}

/** Update the `best` symlink to point to the highest-scoring version. */
export async function updateBest(site: string, name: string): Promise<void> {
  const base = historyDir(site, name);
  let best = "";
  let bestScore = -1;

  try {
    for await (const e of Deno.readDir(base)) {
      if (!e.isDirectory || !e.name.match(/^v\d+$/)) continue;
      try {
        const scoreJson = await Deno.readTextFile(`${base}/${e.name}/score.json`);
        const score = JSON.parse(scoreJson);
        const rate = score.success_rate ?? 0;
        if (rate > bestScore) {
          bestScore = rate;
          best = e.name;
        }
      } catch { /* no score */ }
    }
  } catch { return; }

  if (best) {
    const link = `${base}/best`;
    await Deno.remove(link).catch(() => {});
    await Deno.symlink(best, link).catch(() => {});
  }
}

/** Read all versions with their scores for Meta-Forge proposer context. */
export async function readHistory(
  site: string,
  name: string,
): Promise<Array<{ version: string; score?: Record<string, unknown>; traceCount: number; hasCode: boolean }>> {
  const base = historyDir(site, name);
  const versions: Array<{ version: string; score?: Record<string, unknown>; traceCount: number; hasCode: boolean }> = [];

  try {
    for await (const e of Deno.readDir(base)) {
      if (!e.isDirectory || !e.name.match(/^v\d+$/)) continue;
      const vdir = `${base}/${e.name}`;
      let score: Record<string, unknown> | undefined;
      try { score = JSON.parse(await Deno.readTextFile(`${vdir}/score.json`)); } catch { /* no score */ }
      let traceCount = 0;
      try { for await (const t of Deno.readDir(`${vdir}/traces`)) { if (t.isFile) traceCount++; } } catch { /* no traces */ }
      const hasCode = await Deno.stat(`${vdir}/tap.js`).then(() => true).catch(() => false);
      versions.push({ version: e.name, score, traceCount, hasCode });
    }
  } catch { /* no history */ }

  return versions.sort((a, b) => a.version.localeCompare(b.version));
}
