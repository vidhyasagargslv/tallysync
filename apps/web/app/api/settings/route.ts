import { currentApiKey, handle, json } from '@/lib/auth'
import { getSetting } from '@/lib/db'
export const dynamic = 'force-dynamic'
export function GET() {
  return handle(() => json({ apiKey: currentApiKey(), company: { guid: getSetting('company_guid') ?? null, name: getSetting('company_name') ?? null, gstin: getSetting('company_gstin') ?? null } }))
}
