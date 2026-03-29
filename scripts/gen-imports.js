#!/usr/bin/env node
/**
 * Generate static import lines for background.js from claws/manifest.json.
 * MV3 service workers prohibit dynamic import(), so all claws must be statically imported.
 *
 * Usage: node scripts/gen-imports.js
 * Then paste the output into background.js replacing the existing import block.
 */

const fs = require('fs')
const path = require('path')

const manifest = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../extension-v2/claws/manifest.json'), 'utf-8'
))

const vars = []
for (const file of manifest) {
  const name = 'c_' + file.replace('.claw.js', '').replace(/[\/-]/g, '_')
  vars.push({ name, file })
}

console.log('// --- Static imports (auto-generated) ---\n')
for (const { name, file } of vars) {
  console.log(`import ${name} from './claws/${file}'`)
}
console.log('\nconst ALL_CLAWS = [')
const lines = []
for (let i = 0; i < vars.length; i += 5) {
  lines.push('  ' + vars.slice(i, i + 5).map(v => v.name).join(', ') + ',')
}
console.log(lines.join('\n'))
console.log(']\n')
console.log('for (const mod of ALL_CLAWS) registerClaw(mod)')
console.log(`console.log(\`[claw] registered \${ALL_CLAWS.length} claws\`)`)
