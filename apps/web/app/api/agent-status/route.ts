import { getSetting } from '@/lib/db'
import { handle, json } from '@/lib/auth'
import { counts, latestStatus, pullState } from '@/lib/repo'
export const dynamic = 'force-dynamic'
export function GET() {
  return handle(() => json({
    agent: latestStatus(), counts: counts(), pullState: pullState(),
    linkedCompany: { guid: getSetting('company_guid') ?? null, name: getSetting('company_name') ?? null, gstin: getSetting('company_gstin') ?? null }
  }))
}
