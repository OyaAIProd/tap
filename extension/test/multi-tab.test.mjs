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
const EXECUTOR_SRC = readFileSync(new URL('../protocol/executor.js', import.meta.url), 'utf-8')

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
// Why: without explicit tabId, all commands go to activeTabId.
//      Two concurrent callers clobber each other's tab context.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 1: Tab Routing ──\n')

test('routeCDP extracts tabId from params', () => {
  // Why: CDP commands must route to the tab specified by the caller, not a global
  const routeCDP = BG_SRC.substring(
    BG_SRC.indexOf('async function routeCDP'),
    BG_SRC.indexOf('// --- Bridge Commands ---')
  )
  assert(routeCDP.includes('params.tabId'),
    'routeCDP must extract tabId from params')
})

test('requireTab accepts params and extracts tabId', () => {
  // Why: every command handler calls requireTab — it must route to the right tab
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
  // Why: requireTab() without params always returns activeTabId — defeats multi-tab
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
// Why: Chrome allows one debugger per tab. Global debuggerTabId means
//      switching tabs detaches the previous tab's debugger, losing events.
//      Per-tab sessions allow concurrent debugger usage on different tabs.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 2: Debugger Isolation ──\n')

test('debugger state is per-tab (Map), not a single global', () => {
  // Why: single debuggerTabId = tab switch kills previous session
  assert(BG_SRC.includes('debuggerSessions') && BG_SRC.includes('new Map'),
    'must use a Map for per-tab debugger sessions')
  assert(!BG_SRC.match(/^let debuggerTabId/m),
    'must not have a global debuggerTabId variable')
})

test('ensureDebugger accepts tabId parameter', () => {
  // Why: debugger must attach to the specified tab, not a global
  assert(BG_SRC.includes('async function ensureDebugger(tabId)'),
    'ensureDebugger must accept tabId parameter')
})

test('withDebugger accepts tabId parameter', () => {
  // Why: debugger wrapper must route to the specified tab
  assert(BG_SRC.includes('async function withDebugger(tabId'),
    'withDebugger must accept tabId as first parameter')
})

test('cdpClick uses its tabId param for debugger commands, not activeTabId', () => {
  // Why: cdpClick receives tabId but previously used activeTabId for debugger — wrong tab bug
  const cdpClickSection = BG_SRC.substring(
    BG_SRC.indexOf('async function cdpClick'),
    BG_SRC.indexOf('async function cdpClick') + 400
  )
  assert(!cdpClickSection.includes('activeTabId'),
    'cdpClick must use its tabId parameter, not activeTabId')
})

// ═══════════════════════════════════════════════════════════
// Rule 3: No activeTabId Inside Debugger Callbacks
// Why: withDebugger callbacks that reference activeTabId send commands
//      to the wrong tab when activeTabId != the tab being operated on.
//      Callbacks must use the tabId passed by withDebugger.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 3: No activeTabId in Debugger Callbacks ──\n')

test('withDebugger callbacks do not reference activeTabId', () => {
  // Why: activeTabId in callbacks = commands go to wrong tab during concurrent execution
  // Find all withDebugger(tabId, async (tid) => { ... }) blocks and check for activeTabId inside
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

test('chrome.debugger.sendCommand never uses activeTabId directly', () => {
  // Why: debugger commands with activeTabId go to wrong tab during multi-tab execution
  // Exception: ensureDebugger which manages the session itself
  const handleTapSection = BG_SRC.substring(
    BG_SRC.indexOf('async function handleTapCommand'),
    BG_SRC.indexOf('// --- CDP Click Helper ---')
  )
  const badRefs = (handleTapSection.match(/sendCommand\(\s*\{\s*tabId:\s*activeTabId/g) || [])
  assert.equal(badRefs.length, 0,
    `found ${badRefs.length} chrome.debugger.sendCommand using activeTabId in handleTapCommand`)
})

// ═══════════════════════════════════════════════════════════
// Rule 4: Tab Cleanup
// Why: leaked state from closed tabs wastes memory and causes
//      stale debugger references. chrome.tabs.onRemoved must
//      clean up per-tab state.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 4: Tab Cleanup ──\n')

test('tabs.onRemoved cleans up debugger sessions', () => {
  // Why: closed tab with active debugger session = stale state
  assert(BG_SRC.includes('tabs.onRemoved') && BG_SRC.includes('debuggerSessions.delete'),
    'must clean up debugger sessions when tab is removed')
})

test('tabs.onRemoved cleans up network logs', () => {
  // Why: network log entries for closed tabs are never read
  assert(BG_SRC.includes('tabs.onRemoved') && BG_SRC.includes('networkLogs.delete'),
    'must clean up network logs when tab is removed')
})

test('tabs.onRemoved clears activeTabId if closed tab was active', () => {
  // Why: stale activeTabId pointing to closed tab causes "tab not found" errors
  const onRemovedSection = BG_SRC.substring(
    BG_SRC.indexOf('tabs.onRemoved'),
    BG_SRC.indexOf('tabs.onRemoved') + 500
  )
  assert(onRemovedSection.includes('activeTabId = null'),
    'must clear activeTabId when the active tab is closed')
})

// ═══════════════════════════════════════════════════════════
// Rule 5: Network Log Isolation
// Why: single global networkLogEntries mixed events from all tabs.
//      Per-tab network logs prevent cross-tab data leakage.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 5: Network Log Isolation ──\n')

test('network log state is per-tab (Map), not global arrays', () => {
  // Why: global networkLogEntries/networkLogActive mix events from different tabs
  assert(BG_SRC.includes('networkLogs') && BG_SRC.includes('new Map'),
    'must use a Map for per-tab network logs')
  assert(!BG_SRC.match(/^let networkLogEntries/m),
    'must not have global networkLogEntries variable')
  assert(!BG_SRC.match(/^let networkLogActive/m),
    'must not have global networkLogActive variable')
})

// ═══════════════════════════════════════════════════════════
// Rule 6: Backward Compatibility
// Why: existing MCP callers don't pass tabId. activeTabId must remain
//      as the default fallback to avoid breaking existing workflows.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 6: Backward Compatibility ──\n')

test('activeTabId still exists as default fallback', () => {
  // Why: existing callers that don't pass tabId must continue working
  assert(BG_SRC.includes('let activeTabId'),
    'must keep activeTabId as default fallback')
})

test('Bridge.attach still sets activeTabId', () => {
  // Why: existing workflow: Bridge.attach → commands use activeTabId
  const attachSection = BG_SRC.substring(
    BG_SRC.indexOf("case 'Bridge.attach'"),
    BG_SRC.indexOf("case 'Bridge.attach'") + 500
  )
  assert(attachSection.includes('activeTabId = tabId') || attachSection.includes('activeTabId ='),
    'Bridge.attach must set activeTabId for backward compatibility')
})

test('executor runTap accepts tabId parameter', () => {
  // Why: tap execution must support multi-tab from executor level
  assert(EXECUTOR_SRC.includes('export async function runTap(site, name, userArgs'),
    'runTap must be exported')
  assert(EXECUTOR_SRC.includes('tabId'),
    'runTap must accept tabId parameter')
})

// ═══════════════════════════════════════════════════════════
// Rule 7: Tab Management MCP Tools
// Why: multi-tab routing is useless if the AI agent can't create,
//      list, or close tabs. These tools are the user-facing interface.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 7: Tab Management Tools ──\n')

const MCP_SRC = readFileSync(new URL('../../src/mcp.rs', import.meta.url), 'utf-8')

test('MCP exposes tab_list tool', () => {
  // Why: agent must see which tabs are open to decide where to run taps
  assert(MCP_SRC.includes('"tab_list"'),
    'MCP must expose a tab_list tool')
})

test('MCP exposes tab_new tool', () => {
  // Why: agent must be able to create tabs to run taps in parallel on different sites
  assert(MCP_SRC.includes('"tab_new"'),
    'MCP must expose a tab_new tool')
})

test('MCP exposes tab_close tool', () => {
  // Why: agent must clean up tabs it created to avoid tab accumulation
  assert(MCP_SRC.includes('"tab_close"'),
    'MCP must expose a tab_close tool')
})

test('extension handles Tap.tab_list command', () => {
  // Why: MCP tool relays to extension — extension must handle it
  assert(BG_SRC.includes("'Tap.tab_list'"),
    'background.js must handle Tap.tab_list command')
})

test('extension handles Tap.tab_new command', () => {
  // Why: MCP tool relays to extension — extension must handle it
  assert(BG_SRC.includes("'Tap.tab_new'"),
    'background.js must handle Tap.tab_new command')
})

test('extension handles Tap.tab_close command', () => {
  // Why: MCP tool relays to extension — extension must handle it
  assert(BG_SRC.includes("'Tap.tab_close'"),
    'background.js must handle Tap.tab_close command')
})

test('tab_new returns tabId in response', () => {
  // Why: agent needs the tabId to pass to subsequent commands
  const tabNewSection = BG_SRC.substring(
    BG_SRC.indexOf("'Tap.tab_new'"),
    Math.min(BG_SRC.indexOf("'Tap.tab_new'") + 500, BG_SRC.length)
  )
  assert(tabNewSection.includes('tabId') && tabNewSection.includes('tab.id'),
    'tab_new must return tabId so agent can use it for subsequent commands')
})

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
