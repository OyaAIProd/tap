/**
 * Constraint: multi-tab routing invariants
 * Classification: safety / what — wrong tab = data from wrong site, debugger on wrong tab
 *
 * Why: single activeTabId global caused all commands to go to one tab.
 * Multi-tab requires every function to route via explicit tabId parameter,
 * falling back to activeTabId only when no tabId is specified.
 *
 * Run: node extension/test/multi-tab.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

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
// Rule 1: Tab Routing — commands must accept tabId
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 1: Tab Routing ──\n')

test('routeCDP extracts tabId from params', () => {
  const routeCDP = BG_SRC.substring(
    BG_SRC.indexOf('async function routeCDP'),
    BG_SRC.indexOf('// --- Bridge Commands ---')
  )
  assert(routeCDP.includes('params.tabId'),
    'routeCDP must extract tabId from params')
})

test('requireTab accepts params and extracts tabId', () => {
  const requireTab = BG_SRC.substring(
    BG_SRC.indexOf('async function requireTab'),
    BG_SRC.indexOf('async function requireTab') + 300
  )
  assert(requireTab.includes('params.tabId'),
    'requireTab must extract tabId from params')
  assert(requireTab.includes('activeTabId'),
    'requireTab must fall back to activeTabId when no tabId provided')
})

test('all requireTab() calls pass params', () => {
  const handleTapSection = BG_SRC.substring(
    BG_SRC.indexOf('async function handleTapCommand'),
    BG_SRC.indexOf('// --- CDP Click Helper ---')
  )
  const bareCallCount = (handleTapSection.match(/requireTab\(\)/g) || []).length
  assert.equal(bareCallCount, 0,
    `found ${bareCallCount} bare requireTab() calls without params — must pass params for tabId routing`)
})

// ═══════════════════════════════════════════════════════════
// Rule 2: Debugger Isolation — per-tab sessions
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 2: Debugger Isolation ──\n')

test('debugger state is per-tab (Map), not a single global', () => {
  assert(BG_SRC.includes('debuggerSessions') && BG_SRC.includes('new Map'),
    'must use a Map for per-tab debugger sessions')
  assert(!BG_SRC.match(/^let debuggerTabId/m),
    'must not have a global debuggerTabId variable')
})

test('ensureDebugger accepts tabId parameter', () => {
  assert(BG_SRC.includes('async function ensureDebugger(tabId)'),
    'ensureDebugger must accept tabId parameter')
})

test('withDebugger accepts tabId parameter', () => {
  assert(BG_SRC.includes('async function withDebugger(tabId'),
    'withDebugger must accept tabId as first parameter')
})

test('cdpClick uses its tabId param, not activeTabId', () => {
  const cdpClickSection = BG_SRC.substring(
    BG_SRC.indexOf('async function cdpClick'),
    BG_SRC.indexOf('async function cdpClick') + 400
  )
  assert(!cdpClickSection.includes('activeTabId'),
    'cdpClick must use its tabId parameter, not activeTabId')
})

// ═══════════════════════════════════════════════════════════
// Rule 3: No activeTabId Inside Debugger Callbacks
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 3: No activeTabId in Debugger Callbacks ──\n')

test('withDebugger callbacks do not reference activeTabId', () => {
  const withDbgPattern = /withDebugger\([^,]+,\s*async\s*\([^)]*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g
  let match
  const violations = []
  while ((match = withDbgPattern.exec(BG_SRC)) !== null) {
    const body = match[1]
    if (body.includes('activeTabId')) {
      const lineNum = BG_SRC.substring(0, match.index).split('\n').length
      violations.push(`line ~${lineNum}`)
    }
  }
  assert.equal(violations.length, 0,
    `withDebugger callbacks reference activeTabId at: ${violations.join(', ')}`)
})

// ═══════════════════════════════════════════════════════════
// Rule 4: Tab Cleanup
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 4: Tab Cleanup ──\n')

test('tabs.onRemoved cleans up debugger sessions', () => {
  assert(BG_SRC.includes('tabs.onRemoved') && BG_SRC.includes('debuggerSessions.delete'),
    'must clean up debugger sessions when tab is removed')
})

test('tabs.onRemoved cleans up network logs', () => {
  assert(BG_SRC.includes('tabs.onRemoved') && BG_SRC.includes('networkLogs.delete'),
    'must clean up network logs when tab is removed')
})

test('tabs.onRemoved clears activeTabId if closed tab was active', () => {
  const onRemovedSection = BG_SRC.substring(
    BG_SRC.indexOf('tabs.onRemoved'),
    BG_SRC.indexOf('tabs.onRemoved') + 500
  )
  assert(onRemovedSection.includes('activeTabId = null'),
    'must clear activeTabId when the active tab is closed')
})

// ═══════════════════════════════════════════════════════════
// Rule 5: Network Log Isolation
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 5: Network Log Isolation ──\n')

test('network log state is per-tab (Map), not global arrays', () => {
  assert(BG_SRC.includes('networkLogs') && BG_SRC.includes('new Map'),
    'must use a Map for per-tab network logs')
  assert(!BG_SRC.match(/^let networkLogEntries/m),
    'must not have global networkLogEntries variable')
})

// ═══════════════════════════════════════════════════════════
// Rule 6: Backward Compatibility
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 6: Backward Compatibility ──\n')

test('activeTabId still exists as default fallback', () => {
  assert(BG_SRC.includes('let activeTabId'),
    'must keep activeTabId as default fallback')
})

test('Bridge.attach still sets activeTabId', () => {
  const attachSection = BG_SRC.substring(
    BG_SRC.indexOf("case 'Bridge.attach'"),
    BG_SRC.indexOf("case 'Bridge.attach'") + 500
  )
  assert(attachSection.includes('activeTabId = tabId') || attachSection.includes('activeTabId ='),
    'Bridge.attach must set activeTabId for backward compatibility')
})

test('Bridge.newTab updates activeTabId', () => {
  const newTabSection = BG_SRC.substring(
    BG_SRC.indexOf("case 'Bridge.newTab'"),
    BG_SRC.indexOf("case 'Bridge.newTab'") + 300
  )
  assert(newTabSection.includes('activeTabId = tab.id'),
    'Bridge.newTab must update activeTabId so subsequent commands use the new tab')
})

// ═══════════════════════════════════════════════════════════
// Rule 7: Tab Management Tools (dot notation)
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 7: Tab Management Tools ──\n')

test('extension handles tab.list command', () => {
  assert(BG_SRC.includes("'tab.list'"),
    'background.js must handle tab.list command')
})

test('extension handles tab.new command', () => {
  assert(BG_SRC.includes("'tab.new'"),
    'background.js must handle tab.new command')
})

test('extension handles tab.close command', () => {
  assert(BG_SRC.includes("'tab.close'"),
    'background.js must handle tab.close command')
})

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
