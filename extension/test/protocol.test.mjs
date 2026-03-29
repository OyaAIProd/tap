/**
 * Constraint: Tap protocol contract (POSIX-inspired kernel + stdlib)
 * Classification: safety / what — missing method = tap runtime crash
 *
 * Why: protocol.js is the only interface between .tap.js and the browser.
 * If a method is missing or misnamed, taps fail silently.
 *
 * Architecture: 8 kernel primitives + 16 stdlib operations = 24 total
 *
 * Run: node extension/test/protocol.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

// Kernel: irreducible primitives every runtime must implement
const KERNEL_METHODS = ['eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot', 'tap', 'capabilities']

// Stdlib: named operations built on kernel, runtime may override
const STDLIB_METHODS = ['click', 'type', 'hover', 'scroll', 'pressKey', 'select', 'upload', 'dialog',
  'fetch', 'find', 'cookies', 'download', 'waitFor', 'waitForNetwork', 'ssrState', 'storage']

const ALL_METHODS = [...KERNEL_METHODS, ...STDLIB_METHODS]

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

console.log('\nprotocol constraints (POSIX kernel + stdlib)\n')

const src = readFileSync(new URL('../protocol/protocol.js', import.meta.url), 'utf-8')

test('protocol.js exists and is non-empty', () => {
  assert(src.length > 0)
})

test('exports createPage function', () => {
  assert(src.includes('export function createPage'))
})

// --- Architecture constraints ---

console.log('\n  kernel architecture\n')

test('createKernel function exists (runtime-specific layer)', () => {
  assert(src.includes('function createKernel('), 'must have createKernel for runtime-specific primitives')
})

test('createStdlib function exists (built on kernel)', () => {
  assert(src.includes('function createStdlib(kernel'), 'must have createStdlib that takes kernel as argument')
})

test('stdlib receives kernel as dependency (dependency inversion)', () => {
  assert(src.includes('createStdlib(kernel)'), 'createPage must pass kernel to createStdlib')
})

// --- Kernel primitives ---

console.log('\n  kernel primitives (8)\n')

for (const method of KERNEL_METHODS) {
  test(`kernel.${method} is defined`, () => {
    const patterns = [`async ${method}(`, `${method}(`]
    const kernelSection = src.substring(src.indexOf('function createKernel'), src.indexOf('function createStdlib'))
    const found = patterns.some(p => kernelSection.includes(p))
    assert(found, `kernel.${method} not found in createKernel`)
  })
}

// --- Stdlib operations ---

console.log('\n  stdlib operations (16)\n')

for (const method of STDLIB_METHODS) {
  test(`stdlib.${method} is defined`, () => {
    const patterns = [`async ${method}(`, `${method}(`]
    const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPage'))
    const found = patterns.some(p => stdlibSection.includes(p))
    assert(found, `stdlib.${method} not found in createStdlib`)
  })
}

// --- Public API (flat merge) ---

console.log('\n  public API (flat merge)\n')

for (const method of ALL_METHODS) {
  test(`page.${method} is exposed`, () => {
    const pageSection = src.substring(src.indexOf('const page = {'), src.indexOf('return page'))
    assert(pageSection.includes(`${method}:`), `page.${method} not exposed in createPage`)
  })
}

// --- Structural constraints ---

console.log('\n  structural constraints\n')

test('createPage returns page object', () => {
  const apiSection = src.substring(src.indexOf('export function createPage'))
  assert(apiSection.includes('return page'))
})

test('stdlib uses kernel.eval (not chrome.scripting directly)', () => {
  const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPage'))
  assert(stdlibSection.includes('kernel.eval'), 'stdlib should call kernel.eval')
  assert(!stdlibSection.includes('chrome.scripting'), 'stdlib must NOT use chrome.scripting directly — use kernel.eval')
})

test('stdlib uses kernel.pointer (not chrome.debugger directly for mouse)', () => {
  const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPage'))
  assert(stdlibSection.includes('kernel.pointer'), 'stdlib should call kernel.pointer for mouse operations')
})

test('stdlib uses kernel.keyboard (not chrome.debugger directly for keys)', () => {
  const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPage'))
  assert(stdlibSection.includes('kernel.keyboard'), 'stdlib should call kernel.keyboard for key operations')
})

test('withDebugger helper exists for ms-level attach/detach', () => {
  assert(src.includes('withDebugger'), 'must have withDebugger helper')
  assert(src.includes('debugger.attach'), 'must have debugger attach')
  assert(src.includes('debugger.detach'), 'must have debugger detach')
})

test(`exactly ${ALL_METHODS.length} methods in page API`, () => {
  const pageSection = src.substring(src.indexOf('const page = {'), src.indexOf('return page'))
  // Count property assignments like 'methodName: kernel.method' or 'methodName: stdlib.method'
  const assignments = pageSection.match(/\w+:\s*(kernel|stdlib)\.\w+/g) || []
  assert.equal(assignments.length, ALL_METHODS.length,
    `expected ${ALL_METHODS.length} page methods, found ${assignments.length}: ${assignments.join(', ')}`)
})

// --- Isolation constraints (safety / what — violation = architectural rot) ---

console.log('\n  isolation constraints\n')

test('kernel does not call or import stdlib (no circular dependency)', () => {
  // Why: kernel is the primitive layer — if it calls stdlib, a new runtime can't implement kernel independently
  const kernelSection = src.substring(src.indexOf('function createKernel'), src.indexOf('function createStdlib'))
  assert(!kernelSection.includes('createStdlib'), 'kernel must not call createStdlib')
  assert(!kernelSection.includes('stdlib.'), 'kernel must not call stdlib methods')
})

test('only createPage and PROTOCOL_VERSION are exported', () => {
  // Why: kernel and stdlib are internal — external code sees merged page object + version constant
  const exports = src.match(/export\s+(function|const|let|var|class)\s+\w+/g) || []
  assert.equal(exports.length, 2, `expected 2 exports, found ${exports.length}: ${exports.join(', ')}`)
  assert(exports.some(e => e.includes('createPage')), 'must export createPage')
  assert(exports.some(e => e.includes('PROTOCOL_VERSION')), 'must export PROTOCOL_VERSION')
})

// --- Protocol versioning (safety / what — mismatched versions = silent breakage across runtimes) ---

console.log('\n  protocol versioning\n')

test('PROTOCOL_VERSION constant exists and is semver', () => {
  // Why: without a version, runtimes and taps can't negotiate compatibility
  const match = src.match(/export\s+const\s+PROTOCOL_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/)
  assert(match, 'PROTOCOL_VERSION must be exported as semver string (e.g. "1.0.0")')
})

test('capabilities() includes protocol version', () => {
  // Why: runtime self-declaration must include version so callers can check compatibility
  const capImpl = src.indexOf('capabilities() {')
  assert(capImpl !== -1, 'capabilities() not found')
  const capSection = src.substring(capImpl, capImpl + 800)
  assert(capSection.includes('PROTOCOL_VERSION'), 'capabilities() must include PROTOCOL_VERSION')
})

// --- Cross-domain constraint (safety / what-x-what — bridge must delegate to protocol) ---

console.log('\n  cross-domain: bridge → protocol delegation\n')

const bgSrc = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf-8')

test('background.js imports createPage from protocol.js', () => {
  // Why: bridge must use the protocol layer, not reimplement operations
  assert(bgSrc.includes("import { createPage }"), 'background.js must import createPage')
})

test('background.js has getPage factory', () => {
  // Why: factory binds tabId + deps, creating protocol instances for delegation
  assert(bgSrc.includes('function getPage('), 'must have getPage factory')
  assert(bgSrc.includes('createPage('), 'getPage must call createPage')
})

const DELEGATED_HANDLERS = [
  ['click', 'page.click'],
  ['click_selector', 'page.click'],
  ['type_text', 'page.type'],
  ['hover', 'page.hover'],
  ['scroll', 'page.scroll'],
  ['press_key', 'page.pressKey'],
  ['select', 'page.select'],
  ['upload', 'page.upload'],
  ['find', 'page.find'],
  ['cookies', 'page.cookies'],
  ['dismiss_dialog', 'page.dialog'],
  ['storage_items', 'page.storage'],
]

for (const [handler, delegation] of DELEGATED_HANDLERS) {
  test(`${handler} delegates to ${delegation}`, () => {
    // Why: single source of truth — bridge must not reimplement what protocol provides
    const casePattern = `case '${handler}':`
    const caseStart = bgSrc.indexOf(casePattern)
    assert(caseStart !== -1, `${handler} handler not found`)
    const nextCase = bgSrc.indexOf("case '", caseStart + casePattern.length)
    const handlerSection = bgSrc.substring(caseStart, nextCase !== -1 ? nextCase : caseStart + 500)
    assert(handlerSection.includes('getPage('), `${handler} must use getPage()`)
    const method = delegation.split('.')[1]
    assert(handlerSection.includes(`.${method}(`), `${handler} must call .${method}()`)
  })
}

test('no legacy Tap.* prefix in case statements', () => {
  // Why: protocol envelope routes by method name directly, Tap. prefix is dead code
  const tapCases = bgSrc.match(/case\s+'Tap\./g) || []
  assert.equal(tapCases.length, 0, `found ${tapCases.length} legacy Tap.* case statements — remove prefix`)
})

test('handleMessage does not route by Tap.* or Bridge.* prefix', () => {
  // Why: all bridge communication uses protocol envelope now, prefix routing is legacy
  const handleMsgSection = bgSrc.substring(bgSrc.indexOf('async function handleMessage('), bgSrc.indexOf('async function handleMessage(') + 800)
  assert(!handleMsgSection.includes("startsWith('Tap.')"), 'handleMessage must not route by Tap.* prefix')
  assert(!handleMsgSection.includes("startsWith('Bridge.')"), 'handleMessage must not route by Bridge.* prefix')
})

test('WebSocket bridge routes through handleMessage', () => {
  // Why: all Rust→Extension communication must go through the unified message handler
  const onMessageIdx = bgSrc.indexOf('.onmessage')
  assert(onMessageIdx !== -1, 'WebSocket onmessage handler must exist')
  const onCloseIdx = bgSrc.indexOf('.onclose', onMessageIdx)
  const wsHandler = bgSrc.substring(onMessageIdx, onCloseIdx !== -1 ? onCloseIdx : onMessageIdx + 500)
  assert(wsHandler.includes('handleMessage'), 'WebSocket must route through handleMessage')
})

// --- Capability constraint (quality / what — capabilities() must be accurate) ---

console.log('\n  capability accuracy\n')

test('capabilities() kernel list matches KERNEL_METHODS', () => {
  // Why: capabilities() is the runtime's self-declaration — if stale, scripts can't negotiate
  // Find the actual implementation (skip JSDoc), look for 'capabilities() {' pattern
  const capImpl = src.indexOf('capabilities() {')
  assert(capImpl !== -1, 'capabilities() implementation not found')
  const capSection = src.substring(capImpl, capImpl + 600)
  for (const m of KERNEL_METHODS) {
    assert(capSection.includes(`'${m}'`), `capabilities() missing kernel method '${m}'`)
  }
})

test('capabilities() stdlib list matches STDLIB_METHODS', () => {
  // Why: same as above — stdlib declaration must match actual stdlib
  const capImpl = src.indexOf('capabilities() {')
  const capSection = src.substring(capImpl, capImpl + 600)
  for (const m of STDLIB_METHODS) {
    assert(capSection.includes(`'${m}'`), `capabilities() missing stdlib method '${m}'`)
  }
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
