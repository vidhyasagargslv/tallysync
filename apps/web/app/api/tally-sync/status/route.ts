import { HeartbeatZ } from '@tallysync/contracts'
import { handle, json, requireAgent } from '@/lib/auth'
import { saveStatus } from '@/lib/repo'
export const dynamic = 'force-dynamic'

/** Agent contract: heartbeat. Not company-gated, so a blocked agent can still report why it is blocked. */
export function POST(req: Request) {
  return handle(async () => {
    requireAgent(req, { gate: false })
    saveStatus(HeartbeatZ.parse(await req.json()))
    return json({ ok: true })
  })
}
