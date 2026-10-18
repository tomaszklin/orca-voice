// Buduje stronę Orca Mobile (lista, czat, pliki…) z tego drzewa, do wbudowania w APK.
// Użycie: node voice/build-page.mjs <katalog-wyjściowy>
//
// Skrypt Orki `config/scripts/build-mobile-web-app-bundle.mjs` importuje `esbuild` z głównego
// workspace'u, którego tu nie instalujemy (zależności desktopu). Hook przekierowuje ten jeden import
// na esbuild z `mobile/node_modules`; resztę skrypt i tak bierze stamtąd.
import { register } from 'node:module'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outArg = process.argv[2]
if (!outArg) {
  console.error(
    'Podaj katalog wyjściowy, np.: node voice/build-page.mjs mobile/android/app/src/main/assets/voice-page'
  )
  process.exit(1)
}
const outDir = path.resolve(outArg)

const esbuildMain = pathToFileURL(
  path.join(root, 'mobile', 'node_modules', 'esbuild', 'lib', 'main.js')
).href
const hook = `export async function resolve(specifier, context, next) {
  if (specifier === 'esbuild') return { url: ${JSON.stringify(esbuildMain)}, shortCircuit: true, format: 'commonjs' }
  return next(specifier, context)
}`
register(`data:text/javascript,${encodeURIComponent(hook)}`)

const { buildMobileWebAppBundle } = await import(
  pathToFileURL(path.join(root, 'config', 'scripts', 'build-mobile-web-app-bundle.mjs')).href
)

// Świeży katalog: stare zasoby z innym hashem zostałyby w APK jako martwy ładunek.
rmSync(outDir, { recursive: true, force: true })
const { manifest, routeKeys } = await buildMobileWebAppBundle({ outDir })
console.log(
  `Strona: ${manifest.assets.length} plików, ${manifest.totalBytes} bajtów, ` +
    `${routeKeys.length} tras, desktop ${manifest.desktopVersion}, buildId ${manifest.buildId.slice(0, 12)} -> ${outDir}`
)
