import { handle, json, requireAgent } from '@/lib/auth'
import { claimPending } from '@/lib/repo'
export const dynamic = 'force-dynamic'

/** Agent contract: records waiting to go to Tally. */
export function GET(req: Request) {
  return handle(() => {
    requireAgent(req)
    const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 25) || 25, 100)
    return json(claimPending(limit))
  })
}
