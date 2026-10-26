import { HttpError, handle, json, requireAgent } from '@/lib/auth'
import { loadMapping } from '@/lib/mapping'
export const dynamic = 'force-dynamic'

/** Agent contract: the active mapping + version/hash. 422 when the file is invalid (agent keeps its last good copy). */
export function GET(req: Request) {
  return handle(() => {
    requireAgent(req, { gate: false })
    const m = loadMapping()
    if (!m.ok) throw new HttpError(422, `mapping invalid: ${m.errors.join('; ')}`)
    return json({ version: m.version, hash: m.hash, source: m.path.split('/').slice(-2).join('/'), mapping: m.mapping })
  })
}
