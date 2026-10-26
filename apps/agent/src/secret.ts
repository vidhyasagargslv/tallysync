/**
 * API key storage. Windows: DPAPI (LocalMachine scope, readable only on this PC) via PowerShell.
 * Elsewhere: file with 0600 permissions. 
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'

const file = () => path.join(dataDir(), process.platform === 'win32' ? 'apikey.dpapi' : 'apikey.secret')

function ps(script: string, input: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true }).trim()
}
const PROTECT = "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'LocalMachine'))"
const UNPROTECT = "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s.Trim()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'LocalMachine'))"

export function saveApiKey(token: string) {
  if (process.platform === 'win32' && process.env.TALLYSYNC_NO_DPAPI !== '1') {
    try { fs.writeFileSync(file(), ps(PROTECT, token)); return } catch { /* fall through to file */ }
  }
  fs.writeFileSync(path.join(dataDir(), 'apikey.secret'), token, { mode: 0o600 })
}
export function loadApiKey(): string | undefined {
  const dp = path.join(dataDir(), 'apikey.dpapi')
  if (process.platform === 'win32' && fs.existsSync(dp)) {
    try { return ps(UNPROTECT, fs.readFileSync(dp, 'utf8')) } catch { return undefined }
  }
  const f = path.join(dataDir(), 'apikey.secret')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : undefined
}
export function clearApiKey() {
  for (const f of ['apikey.dpapi', 'apikey.secret']) fs.rmSync(path.join(dataDir(), f), { force: true })
}
