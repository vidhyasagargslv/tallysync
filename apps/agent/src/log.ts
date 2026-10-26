/** Rotating file logger: logs/agent.log, rotated at 5 MB, keeps 5 files. */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'

const MAX = 5 * 1024 * 1024
const KEEP = 5
let file = ''
export const recent: string[] = []

function rotate() {
  try {
    if (fs.statSync(file).size < MAX) return
  } catch { return }
  for (let i = KEEP - 1; i >= 1; i--) {
    const a = `${file}.${i}`, b = `${file}.${i + 1}`
    if (fs.existsSync(a)) fs.renameSync(a, b)
  }
  fs.renameSync(file, `${file}.1`)
}

export function log(level: 'info' | 'warn' | 'error', msg: string) {
  file ||= path.join(dataDir(), 'logs', 'agent.log')
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}`
  recent.push(line); if (recent.length > 200) recent.shift()
  if (process.env.TALLYSYNC_QUIET !== '1' || level === 'error') (level === 'error' ? console.error : console.log)(line)
  try { rotate(); fs.appendFileSync(file, line + '\n') } catch { /* logging must never crash the agent */ }
}
