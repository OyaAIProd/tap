/**
 * Constraint: extension architecture invariants
 * Classification: safety / what — violations cause silent click failures, debugger conflicts
 *
 * Three rules discovered via production debugging (2026-03-29):
 *   1. Single debugger: protocol.js must NOT own debugger state; uses DI from background.js
 *   2. Click safety: all CDP clicks must verify elementFromPoint before dispatch
 *   3. Atomic composition: multi-step taps compose via page.tap(), not duplicate navigation
 *
 * Run: node extension/test/architecture.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PAGE_API_SRC = readFileSync(new URL('../protocol/protocol.js', import.meta.url), 'utf-8')
const EXECUTOR_SRC = readFileSync(new URL('../protocol/executor.js', import.meta.url), 'utf-8')
const BACKGROUND_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════
// Rule 1: Single Debugger Principle
// Why: Chrome allows one debugger per tab. Two managers = silent event loss.
//      protocol.js had its own withDebugger that conflicted with background.js,
//      causing CDP Input events to be dispatched but silently ignored.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 1: Single Debugger ──\n')

test('protocol.js must NOT have module-level debugger state variables', () => {
  // Why: module-level debuggerTabId/detachTimer caused state split with background.js
  assert(!PAGE_API_SRC.match(/^let\s+_?debugger/m),
    'found module-level debugger state variable — use DI instead')
  assert(!PAGE_API_SRC.match(/^let\s+_?detach/m),
    'found module-level detach timer — debugger lifecycle belongs to background.js')
})

test('createPage accepts cdpClick via dependency injection', () => {
  // Why: page.click() must use background.js's cdpClick to share debugger state
  assert(PAGE_API_SRC.includes('cdpClick'),
    'createPage must accept cdpClick dependency')
})

test('stdlib click delegates to kernel.pointer (which uses injected cdpClick)', () => {
  // Why: click must go through kernel.pointer → cdpClick to share debugger state
  const clickSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async click('),
    PAGE_API_SRC.indexOf('async type(')
  )
  assert(clickSection.includes('kernel.pointer'),
    'stdlib click() must delegate to kernel.pointer')
  // And kernel.pointer must use cdpClick
  const pointerSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async pointer('),
    PAGE_API_SRC.indexOf('async keyboard(')
  )
  assert(pointerSection.includes('cdpClick'),
    'kernel.pointer() must use injected cdpClick')
})

test('executor passes deps to createPage', () => {
  // Why: without DI wiring, page API falls back to broken standalone debugger
  assert(EXECUTOR_SRC.includes('createPage(tabId, deps'),
    'runTap must pass deps to createPage')
})

test('background.js injects cdpClick into runTap', () => {
  // Why: background.js owns the debugger; it must inject its cdpClick into tap execution
  assert(BACKGROUND_SRC.includes('runTap(site, name, args, tabId, { cdpClick'),
    'background.js must pass cdpClick when calling runTap')
})

// ═══════════════════════════════════════════════════════════
// Rule 2: Click Safety — elementFromPoint verification
// Why: scrollIntoView({ block: 'center' }) can push elements behind sticky
//      headers. getBoundingClientRect returns "correct" coords but CDP click
//      hits the occluding element. Must verify with elementFromPoint.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 2: Click Safety ──\n')

test('protocol.js click uses elementFromPoint to verify target is reachable', () => {
  // Why: without verification, CDP clicks silently hit sticky headers instead of target
  const clickSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async click('),
    PAGE_API_SRC.indexOf('async type(')
  )
  assert(clickSection.includes('elementFromPoint'),
    'click() must verify coordinates via elementFromPoint before dispatching CDP click')
})

test('background.js click handlers delegate to protocol (no inline elementFromPoint)', () => {
  // Why: after protocol unification, click safety lives in protocol.js stdlib.click()
  // background.js must delegate via getPage(), not reimplement element finding
  const clickSection = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf("case 'click'"),
    BACKGROUND_SRC.indexOf("case 'type_text'")
  )
  assert(clickSection.includes('getPage('),
    'Tap.click handlers must delegate to protocol via getPage()')
  assert(!clickSection.includes('chrome.scripting.executeScript'),
    'Tap.click handlers must NOT have inline scripting — delegate to protocol')
})

test('no unconditional scrollIntoView in protocol click', () => {
  // Why: unconditional scroll pushes already-visible elements behind sticky headers
  const clickSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async click('),
    PAGE_API_SRC.indexOf('async type(')
  )
  const scrollCalls = clickSection.match(/scrollIntoView/g) || []
  const viewportChecks = clickSection.match(/innerHeight|innerWidth/g) || []
  if (scrollCalls.length > 0) {
    assert(viewportChecks.length > 0,
      'scrollIntoView found without viewport boundary check — must only scroll when element is outside viewport')
  }
})

// ═══════════════════════════════════════════════════════════
// Rule 3: Atomic Tap Composition
// Why: monolithic taps duplicate navigation logic and can't be recombined.
//      "open + detail + comment" as atoms lets AI orchestrate any workflow.
//      Taps that bundle nav+extract+action are fragile and untestable in parts.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 3: Atomic Composition ──\n')

test('page.tap() is wired for composition in executor', () => {
  // Why: page.tap() is the composition primitive; without it, taps can't call each other
  assert(EXECUTOR_SRC.includes('page.tap = async'),
    'executor must wire page.tap() for tap-to-tap composition')
})

test('page.tap() passes deps through for recursive calls', () => {
  // Why: composed taps need cdpClick too; without deps passthrough, nested clicks fail
  const tapWiring = EXECUTOR_SRC.substring(
    EXECUTOR_SRC.indexOf('page.tap'),
    EXECUTOR_SRC.indexOf('page.tap') + 200
  )
  assert(tapWiring.includes('deps'),
    'page.tap() must pass deps to recursive runTap calls')
})

// Check that no xiaohongshu tap duplicates the "search → click → extract" pattern
// that should be composed from open + detail
const TAPS_DIR = new URL('../taps/', import.meta.url).pathname

async function checkComposition() {
  const xhsDir = join(TAPS_DIR, 'xiaohongshu')
  const files = await readdir(xhsDir)
  const tapFiles = files.filter(f => f.endsWith('.tap.js'))

  for (const file of tapFiles) {
    const mod = (await import(pathToFileURL(join(xhsDir, file)).href)).default
    // Skip the 'open' tap itself — it's the navigation primitive
    if (mod.name === 'open') continue

    const body = mod.run?.toString() || ''

    test(`xiaohongshu/${mod.name} does not duplicate open's navigation pattern`, () => {
      // Why: if a tap navigates to search_result AND clicks note-item, it should compose via open
      const hasSearchNav = body.includes('search_result') && body.includes('keyword')
      const hasNoteClick = body.includes('note-item') && body.includes('.click')
      if (hasSearchNav && hasNoteClick) {
        assert.fail(
          `${mod.name} duplicates search→click pattern — should compose via page.tap("xiaohongshu", "open")`
        )
      }
    })
  }
}

await checkComposition()

// ═══════════════════════════════════════════════════════════
// Rule 4: Action Taps Must Not Navigate
// Why: action taps that bundle page.nav() can't be reused when the user
//      is already on the target page. Separating nav from action enables:
//        nav → action  (full flow)
//        action alone  (user already there)
//        nav → detail → AI → action  (AI-orchestrated flow)
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 4: Action Taps Must Not Navigate ──\n')

// Action taps: their purpose is to DO something (publish, comment, generate),
// not to navigate. Navigation should be a separate composable tap.
const ACTION_TAP_NAMES = ['comment', 'publish', 'generate']

async function checkActionTaps() {
  const dirs = await readdir(TAPS_DIR)
  for (const dir of dirs) {
    const dirPath = join(TAPS_DIR, dir)
    let files
    try { files = await readdir(dirPath) } catch { continue }
    const tapFiles = files.filter(f => f.endsWith('.tap.js'))

    for (const file of tapFiles) {
      const mod = (await import(pathToFileURL(join(dirPath, file)).href)).default
      if (!ACTION_TAP_NAMES.includes(mod.name)) continue
      if (!mod.run) continue // extract-format taps don't navigate

      const body = mod.run.toString()

      test(`${mod.site}/${mod.name} action tap does not call page.nav()`, () => {
        // Why: action taps must be pure actions; nav is a separate composable step
        const hasNav = body.includes('page.nav(') || body.includes('page.nav (')
        if (hasNav) {
          assert.fail(
            `${mod.site}/${mod.name} calls page.nav() — split into nav tap + action tap`
          )
        }
      })
    }
  }
}

await checkActionTaps()

// ═══════════════════════════════════════════════════════════
// Rule 5: No Duplicate Extraction Logic Within a Site
// Why: xiaohongshu had search + search_api + search_fast all parsing the same
//      __INITIAL_STATE__. When the site changes its state shape, three taps
//      break instead of one. One source of truth per extraction pattern.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 5: No Duplicate Extraction ──\n')

async function checkDuplicateExtraction() {
  const dirs = await readdir(TAPS_DIR)
  for (const dir of dirs) {
    const dirPath = join(TAPS_DIR, dir)
    let files
    try { files = await readdir(dirPath) } catch { continue }
    const tapFiles = files.filter(f => f.endsWith('.tap.js'))
    if (tapFiles.length < 2) continue

    // Load all taps for this site
    const mods = []
    for (const file of tapFiles) {
      const mod = (await import(pathToFileURL(join(dirPath, file)).href)).default
      const body = (mod.run || mod.extract)?.toString() || ''
      mods.push({ name: mod.name, body, file })
    }

    // Check for duplicate SSR state parsing patterns
    // Match taps that parse search feeds from SSR state (search.feeds or search?.feeds)
    const ssrSearchParsers = mods.filter(m =>
      m.body.includes('__INITIAL_STATE__') && /search\??\.feeds/.test(m.body)
    )
    // Exclude search_fast — intentionally different transport (pure HTTP, no browser)
    const browserSSRParsers = ssrSearchParsers.filter(m => m.name !== 'search_fast')

    test(`${dir}: at most one browser-based SSR search extraction (found ${browserSSRParsers.length})`, () => {
      // Why: multiple taps parsing the same SSR state = multiple breakpoints when state shape changes
      // search_fast is exempt because it uses HTTP fetch (different transport, valid for headless)
      if (browserSSRParsers.length > 1) {
        const names = browserSSRParsers.map(m => m.name).join(', ')
        assert.fail(
          `${dir} has ${browserSSRParsers.length} browser taps parsing SSR search state (${names}) — consolidate into one`
        )
      }
    })
  }
}

await checkDuplicateExtraction()

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
