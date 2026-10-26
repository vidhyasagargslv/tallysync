import { PushResultZ } from '@tallysync/contracts'
import { z } from 'zod'
import { HttpError, handle, json, requireAgent } from '@/lib/auth'
import { applyResult } from '@/lib/repo'
export const dynamic = 'force-dynamic'

/** Agent contract: synced / failed result for one record (or an array). */
export function POST(req: Request) {
  return handle(async () => {
    requireAgent(req)
    const body = await req.json()
    const results = z.array(PushResultZ).parse(Array.isArray(body) ? body : [body])
    for (const r of results) if (!applyResult(r)) throw new HttpError(404, `record ${r.id} not found`)
    return json({ ok: true, count: results.length })
  })
}
