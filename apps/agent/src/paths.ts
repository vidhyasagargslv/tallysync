import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function dataDir(): string {
  if (process.env.TALLYSYNC_HOME) return path.resolve(process.env.TALLYSYNC_HOME)
  if (process.platform === 'win32') return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'TallySync')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'TallySync')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'tallysync')
}
export function ensureDirs() {
  const d = dataDir()
  for (const p of [d, path.join(d, 'logs'), path.join(d, 'state')]) fs.mkdirSync(p, { recursive: true })
  return d
}
export function writeJsonAtomic(file: string, data: unknown, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode })
  fs.renameSync(tmp, file)
}
export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T } catch { return fallback }
}
