/** Loads the declarative Tally mapping (JSONC) from disk; re-read when the file changes. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { TallyMappingZ, type TallyMapping } from '@tallysync/contracts'

export const mappingPath = () => path.resolve(process.env.TALLY_MAPPING_PATH ?? './config/tally-mapping.jsonc')

/** Strip // and /* *\/ comments and trailing commas, leaving strings untouched. */
export function stripJsonc(src: string): string {
  let out = '', i = 0, inStr = false
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (inStr) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue } if (c === '"') inStr = false; i++; continue }
    if (c === '"') { inStr = true; out += c; i++; continue }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += c; i++
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export interface LoadedMapping { ok: boolean; path: string; hash: string; version: string; mapping: TallyMapping | null; errors: string[]; mtime: string | null }
let cache: { key: string; value: LoadedMapping } | null = null

export function loadMapping(): LoadedMapping {
  const file = mappingPath()
  let stat: fs.Stats
  try { stat = fs.statSync(file) } catch {
    return { ok: false, path: file, hash: '', version: '', mapping: null, errors: [`mapping file not found: ${file}`], mtime: null }
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`
  if (cache?.key === key) return cache.value
  const src = fs.readFileSync(file, 'utf8')
  let value: LoadedMapping
  try {
    const r = TallyMappingZ.safeParse(JSON.parse(stripJsonc(src)))
    if (!r.success) value = { ok: false, path: file, hash: '', version: '', mapping: null, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`), mtime: stat.mtime.toISOString() }
    else {
      const hash = crypto.createHash('sha256').update(JSON.stringify(r.data)).digest('hex')
      value = { ok: true, path: file, hash, version: r.data.version, mapping: r.data, errors: [], mtime: stat.mtime.toISOString() }
    }
  } catch (e) {
    value = { ok: false, path: file, hash: '', version: '', mapping: null, errors: [`invalid JSON: ${(e as Error).message}`], mtime: stat.mtime.toISOString() }
  }
  cache = { key, value }
  return value
}
