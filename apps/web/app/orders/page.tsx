import { MASTER_KINDS } from '@tallysync/contracts'
import Link from 'next/link'
import { Action, AutoRefresh } from '@/components/Action'
import { OrderForm } from '@/components/OrderForm'
import { listRecords, nextNumber, objects } from '@/lib/repo'
import { Badge, Table, fdate, fmt, ftime } from '@/lib/ui'
export const dynamic = 'force-dynamic'

export default async function Orders({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type = 'sales_order' } = await searchParams
  const masters = type === 'masters'
  const kind = type === 'purchase_order' ? 'purchase_order' : 'sales_order'
  const recs = masters ? listRecords().filter((r) => (MASTER_KINDS as readonly string[]).includes(r.entity)) : listRecords({ entity: kind })
  const ledgers = objects('ledger')
  const partyGroup = kind === 'sales_order' ? /debtor/i : /creditor/i
  const parties = ledgers.filter((l) => partyGroup.test(l.parent ?? '')).map((l) => l.name)
  return (<>
    <AutoRefresh seconds={8} />
    <h2>{masters ? 'Masters outbox' : kind === 'sales_order' ? 'Sales orders' : 'Purchase orders'}</h2>
    {masters ? <div className="card"><Action url="/api/demo-masters" label="Queue demo masters (units, godown, ledgers, GST, parties, items)" /></div>
      : <OrderForm kind={kind} defaultNumber={nextNumber(kind, kind === 'sales_order' ? 'SO' : 'PO')} parties={parties.length ? parties : ledgers.map((l) => l.name)}
        items={objects('stock_item').map((i) => i.name)} godowns={objects('godown').map((g) => g.name)} />}
    <div className="card">
      <Table empty="Nothing created yet." cols={masters ? [['Type'], ['Name'], ['Status'], ['Action'], ['Tally GUID'], ['Updated'], ['']] : [['Number'], ['Date'], ['Party'], ['Lines', 'num'], ['Amount', 'num'], ['Status'], ['Tally'], ['Updated'], ['']]}
        rows={recs.map((r) => {
          const p = r.payload
          const status = <><Badge s={r.status} />{r.error && <div className="err">{r.error}</div>}</>
          const tail = [ftime(r.updatedAt), <span key="a">{r.status === 'failed' && <Action url={`/api/records/${r.id}/retry`} label="Retry" secondary />} <Link href={`/api/records/${r.id}`}>xml</Link></span>]
          if (masters) return [r.entity, r.label, status, r.action ?? '-', <code key="g">{r.tallyGuid ?? '-'}</code>, ...tail]
          const amt = (p.lines ?? []).reduce((s: number, l: any) => s + l.qty * l.rate, 0)
          return [p.number, fdate(p.date), p.party, (p.lines ?? []).length, fmt(amt), status, r.tallyGuid ? <span title={r.tallyGuid}>{r.action} #{r.voucherNumber}</span> : '-', ...tail]
        })} />
    </div>
  </>)
}
