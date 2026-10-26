import { getMockTally } from './mock/mockTally.js'

export type TallyMode = 'mock' | 'real'

/** Decode Tally HTTP response bytes. Tally may answer in UTF-8 or UTF-16 (LE, with or without BOM). */
export function decodeTallyBytes(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  if (buf.length >= 4 && buf[1] === 0 && buf[3] === 0) return buf.toString('utf16le')
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  return buf.toString('utf8')
}

export class TallyUnreachableError extends Error {}

export interface TallyClientOptions { mode: TallyMode; url: string; timeoutMs?: number }

export class TallyClient {
  readonly mode: TallyMode
  readonly url: string
  readonly timeoutMs: number
  constructor(o: TallyClientOptions) {
    this.mode = o.mode
    this.url = o.url
    this.timeoutMs = o.timeoutMs ?? 30000
  }

  async post(xml: string): Promise<string> {
    if (this.mode === 'mock') return getMockTally().handle(xml)
    let res: Response
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body: Buffer.from(xml, 'utf8'),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      throw new TallyUnreachableError(`Cannot reach Tally at ${this.url} (${msg}). Is TallyPrime running with the XML port enabled?`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok) throw new Error(`Tally HTTP ${res.status} ${res.statusText}`)
    return decodeTallyBytes(buf)
  }
}
