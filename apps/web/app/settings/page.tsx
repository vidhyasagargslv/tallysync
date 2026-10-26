import { Action } from '@/components/Action'
import { ApiKey } from '@/components/ApiKey'
import { currentApiKey } from '@/lib/auth'
import { getSetting } from '@/lib/db'
export const dynamic = 'force-dynamic'
export default function Settings() {
  return (<><h2>Settings</h2>
    <div className="card"><h3 style={{ marginTop: 0 }}>Agent API key</h3>
      <p className="muted">Paste this into the TallySync Agent settings page (http://127.0.0.1:4100 on the Tally PC) together with this app&apos;s URL.</p>
      <ApiKey initial={currentApiKey()} /></div>
    <div className="card"><h3 style={{ marginTop: 0 }}>Linked Tally company</h3>
      <p>Name: <b>{getSetting('company_name') ?? '-'}</b><br />GUID: <code>{getSetting('company_guid') ?? 'not linked yet'}</code><br />GSTIN: {getSetting('company_gstin') ?? '-'}</p>
      <p className="muted">The backend accepts data only from the agent locked to this GUID. To move to another company: reset here, then click Re-link on the agent.</p>
      <Action url="/api/settings/company-link" method="DELETE" label="Reset company link" secondary confirm="Reset the linked company?" /></div>
  </>)
}
