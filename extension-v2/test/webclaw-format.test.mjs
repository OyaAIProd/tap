/**
 * Constraint: .webclaw.js format contract
 * Classification: safety / what — invalid format = runtime crash
 *
 * Two formats:
 *   extract-format: { site, name, description, url, extract() }
 *     - Runtime handles nav, wait, limit, columns inference, health defaults
 *     - Must NOT have: run(), columns, args.limit
 *
 *   run-format: { site, name, description, columns, run() }
 *     - Claw controls everything (interactive / composition claws)
 *     - Must NOT have: extract()
 *     - Must have: columns (can't infer without running)
 *
 * Run: node extension-v2/test/webclaw-format.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLAWS_DIR = new URL('../webclaws/', import.meta.url).pathname
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

async function findClawFiles(dir) {
  const files = []
  for (const site of await readdir(dir)) {
    const sitePath = join(dir, site)
    try {
      for (const file of await readdir(sitePath)) {
        if (file.endsWith('.webclaw.js')) {
          files.push({ site, name: basename(file, '.webclaw.js'), path: join(sitePath, file) })
        }
      }
    } catch { /* not a directory */ }
  }
  return files
}

// --- Constraints ---

console.log('\n.webclaw.js format constraints\n')

const clawFiles = await findClawFiles(CLAWS_DIR)

test('at least one .webclaw.js file exists', () => {
  assert(clawFiles.length > 0, `no .webclaw.js files found in ${CLAWS_DIR}`)
})

for (const { site, name, path } of clawFiles) {
  console.log(`\n  ${site}/${name}.webclaw.js`)

  let mod
  await testAsync(`  loads as ES module`, async () => {
    mod = await import(pathToFileURL(path))
    assert(mod.default, 'must have default export')
  })

  if (!mod?.default) continue
  const claw = mod.default
  const hasRun = typeof claw.run === 'function'
  const hasExtract = typeof claw.extract === 'function'
  const format = hasExtract ? 'extract' : 'run'

  // ===== COMMON CONSTRAINTS (both formats) =====

  test(`  [common] has site`, () => {
    assert.equal(typeof claw.site, 'string', 'site must be string')
  })

  test(`  [common] has name`, () => {
    assert.equal(typeof claw.name, 'string', 'name must be string')
  })

  test(`  [common] has description`, () => {
    assert.equal(typeof claw.description, 'string', 'description is required')
  })

  test(`  [common] site matches directory (${claw.site} === ${site})`, () => {
    assert.equal(claw.site, site)
  })

  test(`  [common] name matches filename (${claw.name} === ${name})`, () => {
    assert.equal(claw.name, name)
  })

  test(`  [common] has exactly one of run() or extract()`, () => {
    assert(hasRun || hasExtract, 'must have run() or extract()')
    assert(!(hasRun && hasExtract), 'must not have both run() and extract()')
  })

  // args validation (both formats)
  if (claw.args) {
    test(`  [common] args have valid types`, () => {
      for (const [key, spec] of Object.entries(claw.args)) {
        assert(spec.type, `arg '${key}' missing type`)
        assert(VALID_ARG_TYPES.includes(spec.type), `arg '${key}' has invalid type '${spec.type}'`)
      }
    })
  }

  // health validation (both formats)
  if (claw.health) {
    test(`  [common] health contract is valid`, () => {
      if (claw.health.min_rows !== undefined) {
        assert.equal(typeof claw.health.min_rows, 'number')
        assert(claw.health.min_rows > 0, 'min_rows must be > 0')
      }
      if (claw.health.non_empty !== undefined) {
        assert(Array.isArray(claw.health.non_empty))
        // Cross-check against columns if columns are declared
        if (claw.columns) {
          for (const field of claw.health.non_empty) {
            assert(claw.columns.includes(field), `health.non_empty field '${field}' not in columns`)
          }
        }
      }
    })
  }

  // No chrome.* direct access (both formats)
  const checkFn = claw.run || claw.extract
  test(`  [common] ${format}() body does not reference chrome.* directly`, () => {
    const src = checkFn.toString()
    assert(!src.includes('chrome.tabs'), 'must not reference chrome.tabs — use page API')
    assert(!src.includes('chrome.scripting'), 'must not reference chrome.scripting — use page API')
    assert(!src.includes('chrome.debugger'), 'must not reference chrome.debugger — use page API')
  })

  // ===== EXTRACT-FORMAT CONSTRAINTS =====

  if (hasExtract) {
    test(`  [extract] has url (string or function)`, () => {
      const valid = (typeof claw.url === 'string' && claw.url.length > 0) || typeof claw.url === 'function'
      assert(valid, 'extract-format requires url (string or function)')
    })

    test(`  [extract] must not have columns (runtime infers)`, () => {
      assert(claw.columns === undefined, 'extract-format must not declare columns — runtime infers from extract() return')
    })

    test(`  [extract] must not have args.limit (runtime provides)`, () => {
      assert(!claw.args?.limit, 'extract-format must not declare args.limit — runtime provides default limit=20')
    })

    test(`  [extract] must not have wait (runtime adaptive)`, () => {
      assert(claw.wait === undefined, 'extract-format must not declare wait — runtime uses adaptive retry')
    })

    // waitFor must be a string if present
    if (claw.waitFor !== undefined) {
      test(`  [extract] waitFor is a string (CSS selector)`, () => {
        assert.equal(typeof claw.waitFor, 'string', 'waitFor must be a CSS selector string')
      })
    }

    // timeout must be a number if present
    if (claw.timeout !== undefined) {
      test(`  [extract] timeout is a number`, () => {
        assert.equal(typeof claw.timeout, 'number', 'timeout must be a number (milliseconds)')
      })
    }
  }

  // ===== RUN-FORMAT CONSTRAINTS =====

  if (hasRun) {
    test(`  [run] has columns (non-empty string array)`, () => {
      assert(Array.isArray(claw.columns), 'run-format requires columns array')
      assert(claw.columns.length > 0, 'columns must not be empty')
      for (const col of claw.columns) {
        assert.equal(typeof col, 'string', `column must be string, got ${typeof col}`)
      }
    })
  }
}

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
