import { MappingValidationZ } from '@tallysync/contracts'
import { handle, json, requireAgent } from '@/lib/auth'
import { setSetting, syncLog } from '@/lib/db'
export const dynamic = 'force-dynamic'

/** Agent contract (optional): mapping checked against the Tally company's masters. */
export function POST(req: Request) {
  return handle(async () => {
    requireAgent(req, { gate: false })
    const v = MappingValidationZ.parse(await req.json())
    setSetting('mapping_validation', JSON.stringify(v))
    syncLog('mapping', null, v.ok ? 'ok' : 'error', v.issues.length ? `${v.issues.length} mapping issue(s): ${v.issues.map((i) => i.message).join(' | ')}` : 'mapping valid against Tally')
    return json({ ok: true })
  })
}
