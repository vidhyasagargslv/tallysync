import { AutoRefresh } from './Action'
import { PartyForm } from './MasterForms'
import { statusCells } from './RecordStatus'
import { parties, partyGroups } from '@/lib/masters'
import { getRecord, listRecords, objects } from '@/lib/repo'
import { RawLink, Table, fmt } from '@/lib/ui'

export function PartyPage({ kind, edit }: { kind: 'customers' | 'suppliers'; edit?: string }) {
  const group = partyGroups()[kind]
  const base = `/${kind}`
  const editing = edit ? getRecord(edit) : null
  const opts = parties(kind)
  const names = new Set(opts.map((p) => p.name.toLowerCase()))
  const local = listRecords({ entity: 'ledger' }).filter((r) => names.has(String(r.payload.name).toLowerCase()))
  const localNames = new Set(local.map((r) => String(r.payload.name).toLowerCase()))
  const tally = new Map(objects('ledger').map((l) => [l.name.toLowerCase(), l]))
  const tallyOnly = [...tally.values()].filter((l) => names.has(l.name.toLowerCase()) && !localNames.has(l.name.toLowerCase()))
  return (<>
    <AutoRefresh seconds={10} />
    <h2>{kind === 'customers' ? 'Customers' : 'Suppliers'}</h2>
    <PartyForm key={editing?.id ?? 'new'} kind={kind === 'customers' ? 'customer' : 'supplier'} group={group} base={base} initial={editing?.payload} editId={editing?.id} />
    <div className="card"><h3 style={{ marginTop: 0 }}>Created here</h3>
      <Table empty={`No ${kind} created yet.`} cols={[['Name'], ['GSTIN'], ['State'], ['Phone'], ['Tally balance', 'num'], ['Status'], ['Tally'], ['Updated'], ['']]}
        rows={local.map((r) => [r.payload.name, r.payload.gstin ?? '-', r.payload.state ?? '-', r.payload.phone ?? '-', fmt(tally.get(String(r.payload.name).toLowerCase())?.data?.closingBalance), ...statusCells(r, `${base}?edit=${r.id}`)])} /></div>
    <div className="card"><h3 style={{ marginTop: 0 }}>Only in Tally (pulled, under {group})</h3>
      <Table empty="None." cols={[['Name'], ['Group'], ['GSTIN'], ['State'], ['Closing (Dr -, Cr +)', 'num'], ['']]}
        rows={tallyOnly.map((l) => [l.name, l.parent ?? '-', l.data?.gstin ?? '-', l.data?.state ?? '-', fmt(l.data?.closingBalance), <RawLink key="r" entity="ledger" guid={l.guid} />])} /></div>
  </>)
}
