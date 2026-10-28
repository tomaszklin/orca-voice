// Jednorazowo udostępnia zbudowany APK telefonowi w prywatnej sieci (ZeroTier/LAN).
// Użycie: node voice/serve-apk.mjs <adres-IP> [port]
// Adres zawiera losowy token, serwer słucha tylko na podanym IP i kończy pracę po 30 minutach
// (albo wcześniej, Ctrl+C). Nie zamyka się po pierwszym pobraniu, bo menedżer pobierania
// Androida potrafi ponowić żądanie.
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [host, port = '8765'] = process.argv.slice(2)
if (!host) {
  console.error('Podaj adres IP, np.: node voice/serve-apk.mjs 10.0.0.5')
  process.exit(1)
}

// Why: fileURLToPath zamiast import.meta.dirname, bo systemowy Node (ten z regułą w zaporze
// Windowsa) to 20.5, a import.meta.dirname pojawiło się w 20.11.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const apk = readdirSync(dist)
  .filter((name) => name.endsWith('.apk'))
  .map((name) => path.join(dist, name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!apk) {
  console.error(`Brak pliku APK w ${dist} - najpierw voice/build-apk.ps1`)
  process.exit(1)
}

const token = randomBytes(12).toString('hex')
const urlPath = `/${token}/${path.basename(apk)}`
const size = statSync(apk).size

const server = createServer((req, res) => {
  if (req.url !== urlPath) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename="${path.basename(apk)}"`
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(apk).pipe(res)
  res.on('finish', () => console.log(`Pobrano cały plik (${new Date().toISOString()}).`))
})

server.listen(Number(port), host, () => {
  console.log(`http://${host}:${port}${urlPath}`)
})
setTimeout(() => {
  console.log('Minęło 30 minut - zamykam serwer.')
  process.exit(0)
}, 30 * 60 * 1000)
