/**
 * Bundle the mcp-server Node.js files into self-contained CJS bundles
 * that can be shipped as Tauri resources inside the .app bundle.
 *
 * Output: src-tauri/resources/mcp-server/{index.js,ws-bridge.js}
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'mcp-server')
const OUT = join(ROOT, 'src-tauri', 'resources', 'mcp-server')

mkdirSync(OUT, { recursive: true })

// Tell Node.js that this directory contains CJS bundles, even if the
// root package.json declares "type": "module".
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ type: 'commonjs' }))

// The bundles read app-config-policy.json next to themselves at runtime,
// so it must ship alongside index.js inside the .app resources.
copyFileSync(join(SRC, 'app-config-policy.json'), join(OUT, 'app-config-policy.json'))

const shared = {
  platform: 'node',
  bundle: true,
  format: 'cjs',
  target: 'node18',
  // Mark optional native bindings as external — ws works fine without them
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
}

// In CJS output esbuild rewrites `import.meta` to an empty `import_meta`
// object, which breaks `new URL('./app-config-policy.json', import.meta.url)`
// at runtime (ERR_INVALID_URL). Point it at the real bundle location instead.
const IMPORT_META_STUB = 'var import_meta = {};'
const IMPORT_META_PATCH =
  'var import_meta = { url: require("node:url").pathToFileURL(__filename).href };'

function fixImportMetaUrl(outfile) {
  let source = readFileSync(outfile, 'utf8')
  if (!source.includes(IMPORT_META_STUB)) {
    throw new Error(`esbuild import.meta stub not found in ${outfile}; update this patch`)
  }
  writeFileSync(outfile, source.split(IMPORT_META_STUB).join(IMPORT_META_PATCH))
}

await build({
  ...shared,
  entryPoints: [join(SRC, 'index.js')],
  outfile: join(OUT, 'index.js'),
})

await build({
  ...shared,
  entryPoints: [join(SRC, 'ws-bridge.js')],
  outfile: join(OUT, 'ws-bridge.js'),
})

fixImportMetaUrl(join(OUT, 'index.js'))
fixImportMetaUrl(join(OUT, 'ws-bridge.js'))

console.log('mcp-server bundled → src-tauri/resources/mcp-server/')
