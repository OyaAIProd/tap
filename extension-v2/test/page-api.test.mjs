/**
 * Constraint: page API contract (POSIX-inspired kernel + stdlib)
 * Classification: safety / what — missing method = tap runtime crash
 *
 * Why: page API is the only interface between .tap.js and the browser.
 * If a method is missing or misnamed, taps fail silently.
 *
 * Architecture: 8 kernel primitives + 16 stdlib operations = 24 total
 *
 * Run: node extension-v2/test/page-api.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

// Kernel: irreducible primitives every runtime must implement
const KERNEL_METHODS = ['eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot', 'tap', 'capabilities']

// Stdlib: named operations built on kernel, runtime may override
const STDLIB_METHODS = ['click', 'type', 'hover', 'scroll', 'pressKey', 'select', 'upload', 'dialog',
  'fetch', 'find', 'cookies', 'download', 'waitFor', 'waitForNetwork', 'getSSRState', 'storage']

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

console.log('\npage API constraints (POSIX kernel + stdlib)\n')

const src = readFileSync(new URL('../runtime/page-api.js', import.meta.url), 'utf-8')

test('page-api.js exists and is non-empty', () => {
  assert(src.length > 0)
})

test('exports createPageAPI function', () => {
  assert(src.includes('export function createPageAPI'))
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
  assert(src.includes('createStdlib(kernel)'), 'createPageAPI must pass kernel to createStdlib')
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
    const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPageAPI'))
    const found = patterns.some(p => stdlibSection.includes(p))
    assert(found, `stdlib.${method} not found in createStdlib`)
  })
}

// --- Public API (flat merge) ---

console.log('\n  public API (flat merge)\n')

for (const method of ALL_METHODS) {
  test(`page.${method} is exposed`, () => {
    const pageSection = src.substring(src.indexOf('const page = {'), src.indexOf('return page'))
    assert(pageSection.includes(`${method}:`), `page.${method} not exposed in createPageAPI`)
  })
}

// --- Structural constraints ---

console.log('\n  structural constraints\n')

test('createPageAPI returns page object', () => {
  const apiSection = src.substring(src.indexOf('export function createPageAPI'))
  assert(apiSection.includes('return page'))
})

test('stdlib uses kernel.eval (not chrome.scripting directly)', () => {
  const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPageAPI'))
  assert(stdlibSection.includes('kernel.eval'), 'stdlib should call kernel.eval')
  assert(!stdlibSection.includes('chrome.scripting'), 'stdlib must NOT use chrome.scripting directly — use kernel.eval')
})

test('stdlib uses kernel.pointer (not chrome.debugger directly for mouse)', () => {
  const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPageAPI'))
  assert(stdlibSection.includes('kernel.pointer'), 'stdlib should call kernel.pointer for mouse operations')
})

test('stdlib uses kernel.keyboard (not chrome.debugger directly for keys)', () => {
  const stdlibSection = src.substring(src.indexOf('function createStdlib'), src.indexOf('export function createPageAPI'))
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

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
