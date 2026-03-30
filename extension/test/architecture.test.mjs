/**
 * Constraint: extension architecture invariants
 * Classification: safety / what — violations cause silent click failures, debugger conflicts
 *
 * Rules discovered via production debugging:
 *   1. Single debugger: protocol.js must NOT own debugger state; uses DI from background.js
 *   2. Click safety: all CDP clicks must verify elementFromPoint before dispatch
 *   3. Tool layer must not bypass kernel
 *   4. Unified wire names: MCP tool name = wire method = extension case (no conversion)
 *
 * Run: node extension/test/architecture.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const PAGE_API_SRC = readFileSync(new URL('../protocol/protocol.js', import.meta.url), 'utf-8')
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
// Rule 1: Single Debugger Owner (background.js)
// Why: protocol.js (kernel) owns CDP state via injected deps.
//      If protocol.js has its own chrome.debugger calls or state,
//      two systems fight over debugger attachment → silent failures.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 1: Single Debugger ──\n')

test('protocol.js does not call chrome.debugger directly', () => {
  // Why: if protocol touches debugger, it conflicts with background.js's attach/detach
  assert(!PAGE_API_SRC.includes('chrome.debugger.sendCommand'),
    'protocol.js must not use chrome.debugger — use injected deps instead')
})

test('protocol.js does not track debugger state', () => {
  // Why: debugger state (attached/detached) must be managed by background.js only
  assert(!PAGE_API_SRC.includes('debuggerAttached'),
    'protocol.js must not track debugger state')
})

test('protocol.js click uses injected cdpClick, not own implementation', () => {
  // Why: inlined CDP clicks in protocol would bypass background.js's single debugger
  const pointerSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async pointer('),
    PAGE_API_SRC.indexOf('async keyboard(')
  )
  assert(pointerSection.includes('cdpClick'),
    'kernel.pointer() must use injected cdpClick')
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

test('background.js click handler delegates to protocol (no inline elementFromPoint)', () => {
  // Why: after protocol unification, click safety lives in protocol.js stdlib.click()
  // background.js must delegate via getPage(), not reimplement element finding
  const clickStart = BACKGROUND_SRC.indexOf("case 'page.click'")
  const nextCase = BACKGROUND_SRC.indexOf("case '", clickStart + 18)
  const clickSection = BACKGROUND_SRC.substring(clickStart, nextCase)
  assert(clickSection.includes('getPage('),
    'click handler must delegate to protocol via getPage()')
  assert(!clickSection.includes('chrome.scripting.executeScript'),
    'click handler must NOT have inline scripting — delegate to protocol')
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
// Rule 3: Tool Layer Must Not Bypass Kernel
// Why: handleTapCommand is the tool dispatch layer. It must delegate to
//      kernel (page.eval, page.nav, etc.) — never call routeCDP or
//      chrome.scripting/chrome.debugger directly. Bypassing the kernel
//      breaks runtime portability and creates invisible coupling.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 3: Tool Layer Must Not Bypass Kernel ──\n')

{
  // Extract handleTapCommand body
  const start = BACKGROUND_SRC.indexOf('async function handleTapCommand(')
  const bodyStart = BACKGROUND_SRC.indexOf('{', start)
  // Find matching closing brace by counting braces
  let depth = 0, end = bodyStart
  for (let i = bodyStart; i < BACKGROUND_SRC.length; i++) {
    if (BACKGROUND_SRC[i] === '{') depth++
    if (BACKGROUND_SRC[i] === '}') depth--
    if (depth === 0) { end = i + 1; break }
  }
  const cmdBody = BACKGROUND_SRC.substring(bodyStart, end)

  test('handleTapCommand does not call routeCDP directly', () => {
    // Why: tool layer must go through kernel (getPage), not bypass to CDP
    assert(!cmdBody.includes('routeCDP('),
      'handleTapCommand calls routeCDP() — must use getPage() kernel methods instead')
  })

  test('handleTapCommand does not use chrome.scripting directly', () => {
    // Why: chrome.scripting belongs to kernel; tool layer uses page.eval()
    assert(!cmdBody.includes('chrome.scripting.'),
      'handleTapCommand uses chrome.scripting — must delegate to kernel via getPage()')
  })

  test('handleTapCommand does not use chrome.debugger directly', () => {
    // Why: chrome.debugger belongs to kernel; tool layer uses page.pointer/keyboard
    assert(!cmdBody.includes('chrome.debugger.'),
      'handleTapCommand uses chrome.debugger — must delegate to kernel via getPage()')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 4: Unified Wire Names
// Why: MCP tool name = wire method = extension case. No conversion layer.
//      Every case in handleTapCommand must use dot notation (page.*, inspect.*, tab.*, intercept.*).
//      Bare names like 'click' or underscore names like 'tab_list' are forbidden.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 4: Unified Wire Names ──\n')

{
  const start = BACKGROUND_SRC.indexOf('async function handleTapCommand(')
  const bodyStart = BACKGROUND_SRC.indexOf('{', start)
  let depth = 0, end = bodyStart
  for (let i = bodyStart; i < BACKGROUND_SRC.length; i++) {
    if (BACKGROUND_SRC[i] === '{') depth++
    if (BACKGROUND_SRC[i] === '}') depth--
    if (depth === 0) { end = i + 1; break }
  }
  const cmdBody = BACKGROUND_SRC.substring(bodyStart, end)

  // Extract all case strings
  const caseNames = [...cmdBody.matchAll(/case\s+'([^']+)'/g)].map(m => m[1])

  test('all handleTapCommand cases use dot notation', () => {
    const bareCases = caseNames.filter(n => !n.includes('.'))
    assert(bareCases.length === 0,
      `found bare case names without dot notation: ${bareCases.join(', ')} — must use prefix.action format`)
  })

  test('no underscore-separated case names (old naming)', () => {
    const underscoreCases = caseNames.filter(n => n.includes('_') && !n.includes('.'))
    assert(underscoreCases.length === 0,
      `found underscore case names: ${underscoreCases.join(', ')} — must use dot notation`)
  })

  test('extension has no executor import (Deno is the only executor)', () => {
    assert(!BACKGROUND_SRC.includes("from './protocol/executor.js'"),
      'background.js must not import executor.js — Deno executor is the single tap runner')
  })
}

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
