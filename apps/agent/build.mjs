// Bundle the agent into one CJS file, and with --exe build a Windows x64 single executable (Node SEA).
// The SEA blob must be produced by the same Node version as the target node.exe, so we download
// the matching official win-x64 node.exe (cached in .cache/) and inject into it. Works from macOS/Linux.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)
const dist = path.join(root, 'dist')
const release = path.join(root, 'release')
fs.mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/main.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outfile: path.join(dist, 'agent.cjs'), legalComments: 'none', minify: false, sourcemap: false, logLevel: 'info'
})
console.log('bundle: dist/agent.cjs')
if (!process.argv.includes('--exe')) process.exit(0)

const version = process.version // e.g. v26.3.1
const target = process.env.SEA_TARGET ?? 'win-x64'
const cache = path.join(root, '.cache')
fs.mkdirSync(cache, { recursive: true }); fs.mkdirSync(release, { recursive: true })
const isWin = target.startsWith('win')
const baseBin = path.join(cache, `node-${version}-${target}${isWin ? '.exe' : ''}`)
if (!fs.existsSync(baseBin)) {
  if (isWin) {
    const url = `https://nodejs.org/dist/${version}/${target}/node.exe`
    console.log(`downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    fs.writeFileSync(baseBin, Buffer.from(await res.arrayBuffer()))
  } else fs.copyFileSync(process.execPath, baseBin)
}
const out = path.join(release, isWin ? 'tallysync-agent.exe' : 'tallysync-agent')
const seaConfig = {
  main: path.join(dist, 'agent.cjs'), output: out, executable: baseBin,
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false
}
fs.writeFileSync(path.join(dist, 'sea-config.json'), JSON.stringify(seaConfig, null, 2))
try {
  execFileSync(process.execPath, ['--build-sea', path.join(dist, 'sea-config.json')], { stdio: 'inherit' })
} catch {
  // older Node: blob + postject
  console.log('--build-sea unavailable, falling back to blob + postject')
  const blob = path.join(dist, 'sea-prep.blob')
  fs.writeFileSync(path.join(dist, 'sea-config.json'), JSON.stringify({ ...seaConfig, output: blob, executable: undefined }, null, 2))
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(dist, 'sea-config.json')], { stdio: 'inherit' })
  fs.copyFileSync(baseBin, out)
  execFileSync('npx', ['postject', out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(isWin ? [] : ['--macho-segment-name', 'NODE_SEA'])], { stdio: 'inherit' })
}
console.log(`exe: ${path.relative(root, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, node ${version}, ${target})`)
console.log('note: the exe is unsigned; sign it with signtool (Authenticode) before shipping to clients.')
