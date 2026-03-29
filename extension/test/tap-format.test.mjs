/**
 * Constraint: .tap.js format contract
 * Classification: safety / what — invalid format = runtime crash
 *
 * Two formats:
 *   extract-format: { site, name, description, url, extract() }
 *     - Runtime handles nav, wait, limit, columns inference, health defaults
 *     - Must NOT have: run(), columns, args.limit
 *
 *   run-format: { site, name, description, columns, run() }
 *     - Tap controls everything (interactive / composition taps)
 *     - Must NOT have: extract()
 *     - Must have: columns (can't infer without running)
 *
 * Run: node extension/test/tap-format.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const TAPS_DIR = new URL('../taps/', import.meta.url).pathname
const VALID_ARG_TYPES = ['string', 'int', 'float', 'boolean']

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

async function testAsync(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    ${e.message}`)
  }
}

async function findTapFiles(dir) {
  const files = []
  for (const site of await readdir(dir)) {
    const sitePath = join(dir, site)
    try {
      for (const file of await readdir(sitePath)) {
        if (file.endsWith('.tap.js')) {
          files.push({ site, name: basename(file, '.tap.js'), path: join(sitePath, file) })
        }
      }
    } catch { /* not a directory */ }
  }
  return files
}

// --- Constraints ---

console.log('\n.tap.js format constraints\n')

const tapFiles = await findTapFiles(TAPS_DIR)

test('at least one .tap.js file exists', () => {
  assert(tapFiles.length > 0, `no .tap.js files found in ${TAPS_DIR}`)
})

for (const { site, name, path } of tapFiles) {
  console.log(`\n  ${site}/${name}.tap.js`)

  let mod
  await testAsync(`  loads as ES module`, async () => {
    mod = await import(pathToFileURL(path))
    assert(mod.default, 'must have default export')
  })

  if (!mod?.default) continue
  const tap = mod.default
  const hasRun = typeof tap.run === 'function'
  const hasExtract = typeof tap.extract === 'function'
  const format = hasExtract ? 'extract' : 'run'

  // ===== COMMON CONSTRAINTS (both formats) =====

  test(`  [common] has site`, () => {
    assert.equal(typeof tap.site, 'string', 'site must be string')
  })

  test(`  [common] has name`, () => {
    assert.equal(typeof tap.name, 'string', 'name must be string')
  })

  test(`  [common] has description`, () => {
    assert.equal(typeof tap.description, 'string', 'description is required')
  })

  test(`  [common] site matches directory (${tap.site} === ${site})`, () => {
    assert.equal(tap.site, site)
  })

  test(`  [common] name matches filename (${tap.name} === ${name})`, () => {
    assert.equal(tap.name, name)
  })

  test(`  [common] has exactly one of run() or extract()`, () => {
    assert(hasRun || hasExtract, 'must have run() or extract()')
    assert(!(hasRun && hasExtract), 'must not have both run() and extract()')
  })

  // args validation (both formats)
  if (tap.args) {
    test(`  [common] args have valid types`, () => {
      for (const [key, spec] of Object.entries(tap.args)) {
        assert(spec.type, `arg '${key}' missing type`)
        assert(VALID_ARG_TYPES.includes(spec.type), `arg '${key}' has invalid type '${spec.type}'`)
      }
    })
  }

  // health validation (both formats)
  if (tap.health) {
    test(`  [common] health contract is valid`, () => {
      if (tap.health.min_rows !== undefined) {
        assert.equal(typeof tap.health.min_rows, 'number')
        assert(tap.health.min_rows > 0, 'min_rows must be > 0')
      }
      if (tap.health.non_empty !== undefined) {
        assert(Array.isArray(tap.health.non_empty))
        // Cross-check against columns if columns are declared
        if (tap.columns) {
          for (const field of tap.health.non_empty) {
            assert(tap.columns.includes(field), `health.non_empty field '${field}' not in columns`)
          }
        }
      }
    })
  }

  // requires validation (optional — declares protocol version dependency)
  if (tap.requires) {
    test(`  [common] requires is valid semver range`, () => {
      // Why: taps declare minimum protocol version for runtime compatibility negotiation
      assert.equal(typeof tap.requires, 'string', 'requires must be a semver string (e.g. ">=1.0.0")')
      assert(/^[><=^~]*\d+\.\d+\.\d+/.test(tap.requires), `requires "${tap.requires}" must be semver range`)
    })
  }

  // No chrome.* direct access (both formats)
  const checkFn = tap.run || tap.extract
  test(`  [common] ${format}() body does not reference chrome.* directly`, () => {
    const src = checkFn.toString()
    assert(!src.includes('chrome.tabs'), 'must not reference chrome.tabs — use page API')
    assert(!src.includes('chrome.scripting'), 'must not reference chrome.scripting — use page API')
    assert(!src.includes('chrome.debugger'), 'must not reference chrome.debugger — use page API')
  })

  // ===== EXTRACT-FORMAT CONSTRAINTS =====

  if (hasExtract) {
    test(`  [extract] has url (string or function)`, () => {
      const valid = (typeof tap.url === 'string' && tap.url.length > 0) || typeof tap.url === 'function'
      assert(valid, 'extract-format requires url (string or function)')
    })

    test(`  [extract] must not have columns (runtime infers)`, () => {
      assert(tap.columns === undefined, 'extract-format must not declare columns — runtime infers from extract() return')
    })

    test(`  [extract] must not have args.limit (runtime provides)`, () => {
      assert(!tap.args?.limit, 'extract-format must not declare args.limit — runtime provides default limit=20')
    })

    test(`  [extract] must not have wait (runtime adaptive)`, () => {
      assert(tap.wait === undefined, 'extract-format must not declare wait — runtime uses adaptive retry')
    })

    // waitFor must be a string if present
    if (tap.waitFor !== undefined) {
      test(`  [extract] waitFor is a string (CSS selector)`, () => {
        assert.equal(typeof tap.waitFor, 'string', 'waitFor must be a CSS selector string')
      })
    }

    // timeout must be a number if present
    if (tap.timeout !== undefined) {
      test(`  [extract] timeout is a number`, () => {
        assert.equal(typeof tap.timeout, 'number', 'timeout must be a number (milliseconds)')
      })
    }
  }

  // ===== RUN-FORMAT CONSTRAINTS =====

  if (hasRun) {
    test(`  [run] has columns (non-empty string array)`, () => {
      assert(Array.isArray(tap.columns), 'run-format requires columns array')
      assert(tap.columns.length > 0, 'columns must not be empty')
      for (const col of tap.columns) {
        assert.equal(typeof col, 'string', `column must be string, got ${typeof col}`)
      }
    })
  }
}

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
