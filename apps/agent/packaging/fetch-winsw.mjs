// Downloads WinSW (MIT, https://github.com/winsw/winsw) as bin/tallysync-agent-service.exe
import fs from 'node:fs'
import path from 'node:path'
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'bin')
fs.mkdirSync(dir, { recursive: true })
const out = path.join(dir, 'tallysync-agent-service.exe')
if (!fs.existsSync(out)) {
  const res = await fetch('https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()))
}
console.log(`winsw: ${out} (${fs.statSync(out).size} bytes)`)
