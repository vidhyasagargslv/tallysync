import { HttpError, handle, json, requireAgent } from '@/lib/auth'
import { reportCommand } from '@/lib/syncRequests'
export const dynamic = 'force-dynamic'
/** Agent contract (optional): { status: running|done|failed, summary?, error?, result? } */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAgent(req, { gate: false })
    const r = reportCommand((await ctx.params).id, await req.json())
    if (!r) throw new HttpError(404, 'request not found')
    return json(r)
  })
}
