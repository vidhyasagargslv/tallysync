/** Agent authentication: x-api-key header, constant-time compare. Server-side company gate on x-company-guid. */
import crypto from 'node:crypto'
import { CONTRACT_VERSION, contractMajor } from '@tallysync/contracts'
import { getSetting, setSetting } from './db'

export function currentApiKey(): string {
  let k = getSetting('api_key')
  if (!k) { k = process.env.TALLYSYNC_API_KEY || `tsk_${crypto.randomBytes(24).toString('base64url')}`; setSetting('api_key', k) }
  return k
}
export function regenerateApiKey(): string {
  const k = `tsk_${crypto.randomBytes(24).toString('base64url')}`
  setSetting('api_key', k)
  return k
}

export class HttpError extends Error { constructor(readonly status: number, msg: string) { super(msg) } }

/** Throws HttpError unless the request comes from a valid agent. Returns the company GUID it claims. */
export function requireAgent(req: Request, opts: { gate?: boolean } = { gate: true }): string | null {
  const key = req.headers.get('x-api-key') ?? ''
  const want = currentApiKey()
  const a = Buffer.from(key), b = Buffer.from(want)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'invalid API key')
  const v = req.headers.get('x-contract-version') ?? ''
  if (v && contractMajor(v) !== contractMajor(CONTRACT_VERSION)) throw new HttpError(426, `contract ${v} not supported; backend speaks ${CONTRACT_VERSION}`)
  const guid = req.headers.get('x-company-guid')
  if (opts.gate !== false) {
    const linked = getSetting('company_guid')
    if (!guid) throw new HttpError(409, 'company not locked on agent yet (x-company-guid missing)')
    if (!linked) setSetting('company_guid', guid)
    else if (linked !== guid) throw new HttpError(409, `company mismatch: backend is linked to ${linked}, agent sent ${guid}`)
  }
  return guid
}

export function json(data: unknown, status = 200) { return Response.json(data, { status }) }
export function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  return Promise.resolve().then(fn).catch((e) => {
    if (e instanceof HttpError || typeof e?.status === 'number') return json({ error: e.message }, e.status)
    if (e?.name === 'ZodError') return json({ error: 'validation failed', issues: e.issues }, 400)
    console.error(e)
    return json({ error: String(e?.message ?? e) }, 500)
  })
}
