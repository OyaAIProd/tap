/**
 * Tap executor — loads .tap.js files and runs them.
 *
 * The executor's only job:
 *   1. Load a .tap.js module
 *   2. Create a page API for the active tab
 *   3. Call run(page, args) and return structured data
 */

import { createPage } from './protocol.js'

/** Registry of loaded tap modules, keyed by "site/name" */
const tapRegistry = new Map()

/**
 * Register a tap module in the registry.
 * Called during extension startup to load all bundled taps.
 */
export function registerTap(mod) {
  const key = `${mod.site}/${mod.name}`
  tapRegistry.set(key, mod)
}

/** List all registered taps. */
export function listTaps() {
  return Array.from(tapRegistry.values()).map(({ site, name, description, columns, args }) => ({
    site, name, description: description || '', columns, args: args || {}
  }))
}

/** Get a tap module by site/name. */
export function getTap(site, name) {
  return tapRegistry.get(`${site}/${name}`)
}

/**
 * Execute a tap.
 *
 * Supports two formats:
 *   - run(page, args): full control (legacy + interactive taps)
 *   - extract(args?): minimal — runtime handles nav/wait/limit
 *
 * @param {string} site - Site identifier
 * @param {string} name - Tap name
 * @param {object} userArgs - User-provided arguments
 * @param {number} tabId - Chrome tab ID to operate on
 * @param {object} deps - Injected dependencies from background.js
 * @param {function} deps.cdpClick - CDP click function(tabId, x, y)
 * @param {function} deps.withDebugger - Debugger wrapper function
 * @returns {{ columns: string[], rows: object[] }}
 */
export async function runTap(site, name, userArgs = {}, tabId, deps = {}) {
  const t0 = Date.now()
  const mod = getTap(site, name)
  if (!mod) throw new Error(`tap not found: ${site}/${name}`)

  // For extract-format taps, inject default limit arg
  const argDefs = { ...(mod.args || {}) }
  if (mod.extract && !mod.run && !argDefs.limit) {
    argDefs.limit = { type: 'int', default: 20 }
  }

  // Resolve args with defaults
  const args = {}
  for (const [key, spec] of Object.entries(argDefs)) {
    args[key] = userArgs[key] !== undefined ? coerceArg(userArgs[key], spec.type) : spec.default
  }
  // Pass through any extra args
  for (const [key, val] of Object.entries(userArgs)) {
    if (!(key in args)) args[key] = val
  }

  // Create page API for this tab, injecting background.js debugger functions
  const page = createPage(tabId, deps)

  // Wire up page.tap() for composition
  page.tap = async (s, n, a = {}) => {
    const result = await runTap(s, n, a, tabId, deps)
    return result.rows
  }

  let rows
  let timing = {}

  if (mod.run) {
    // Legacy format: tap controls everything
    const tRun = Date.now()
    rows = await mod.run(page, args)
    timing = { run_ms: Date.now() - tRun, total_ms: Date.now() - t0 }
  } else if (mod.extract) {
    // Minimal format: runtime orchestrates nav + adaptive extract
    const navUrl = typeof mod.url === 'function' ? mod.url(args) : mod.url
    const tNav = Date.now()
    await page.nav(navUrl)
    if (mod.waitFor) {
      await page.waitFor(mod.waitFor, mod.timeout || 10000)
    }
    const navMs = Date.now() - tNav

    const tExtract = Date.now()
    const extracted = await extractUntilReady(page, mod.extract, args, mod.timeout || 15000)
    rows = extracted.rows
    const extractMs = Date.now() - tExtract

    if (args.limit) {
      rows = rows.slice(0, args.limit)
    }

    timing = {
      nav_ms: navMs,
      extract_ms: extractMs,
      retries: extracted.retries,
      total_ms: Date.now() - t0
    }
  } else {
    throw new Error(`tap ${site}/${name} must have run() or extract()`)
  }

  // Validate output
  if (!Array.isArray(rows)) {
    throw new Error(`tap ${site}/${name} must return an array, got ${typeof rows}`)
  }

  // Normalize: all values to trimmed strings
  rows = rows.map(normalizeRow)

  // Infer columns from first row if not declared
  const columns = mod.columns || (rows.length > 0 ? Object.keys(rows[0]) : [])

  // Default health if not specified
  const health = mod.health || (mod.extract && columns.length > 0
    ? { min_rows: 3, non_empty: [columns[0]] }
    : undefined)

  const result = { columns, rows, count: rows.length, timing }
  if (health) result.health = health
  return result
}

/**
 * Run extract repeatedly until it returns a non-empty array or timeout.
 * Replaces fixed wait — uses the extract function itself as the readiness sensor.
 * On failure, diagnoses the page to provide actionable error messages.
 */
async function extractUntilReady(page, fn, args, timeout) {
  const deadline = Date.now() + timeout
  let interval = 500
  let lastError = null
  let retries = 0

  while (Date.now() < deadline) {
    await page.wait(interval)
    try {
      const result = await page.eval(fn, args)
      if (Array.isArray(result) && result.length > 0) return { rows: result, retries }
    } catch (e) {
      lastError = e
    }
    retries++
    interval = Math.min(Math.round(interval * 1.5), 3000)
  }

  // Final attempt
  try {
    const result = await page.eval(fn, args)
    if (Array.isArray(result) && result.length > 0) return { rows: result, retries }
  } catch (e) {
    lastError = e
  }

  // All attempts failed — diagnose why
  const diagnosis = await diagnosePage(page)
  const detail = lastError ? lastError.message : 'empty result'
  throw new Error(diagnosis !== 'ok'
    ? `extract failed: ${diagnosis}`
    : `extract failed after ${timeout}ms: ${detail}`)
}

/**
 * Diagnose page state after extract failure.
 * Returns actionable reason or 'ok' if page looks normal.
 */
async function diagnosePage(page) {
  try {
    const info = await page.eval(() => ({
      url: location.href,
      title: document.title || '',
      bodyLen: document.body?.innerText?.length || 0
    }))
    if (/login|signin|sign_in|passport/i.test(info.url))
      return 'auth_required — visit site and log in first'
    if (/captcha|verify|challenge|security.check/i.test(info.title))
      return 'captcha — solve captcha in browser first'
    if (/404|not.found/i.test(info.title))
      return 'page_not_found'
    if (info.bodyLen < 100)
      return 'empty_page — possible block or network error'
    return 'ok'
  } catch {
    return 'page_unreachable'
  }
}

/** Normalize a row: all values to trimmed strings. */
function normalizeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = v == null ? '' : String(v).trim()
  }
  return out
}

/** Coerce argument to declared type. */
function coerceArg(value, type) {
  switch (type) {
    case 'int': return parseInt(value, 10)
    case 'float': return parseFloat(value)
    case 'boolean': return value === true || value === 'true'
    case 'string': return String(value)
    default: return value
  }
}

/**
 * Parse a tap:// URL into { site, name, args }.
 * Format: tap://site/name?arg1=val1&arg2=val2
 */
export function parseTapURL(url) {
  const match = url.match(/^tap:\/\/([^/]+)\/([^?]+)(?:\?(.*))?$/)
  if (!match) throw new Error(`invalid tap URL: ${url}`)

  const [, site, name, queryString] = match
  const args = {}
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [k, v] = pair.split('=')
      args[decodeURIComponent(k)] = decodeURIComponent(v || '')
    }
  }

  return { site, name, args }
}
