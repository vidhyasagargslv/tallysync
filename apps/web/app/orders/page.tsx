import { MASTER_KINDS } from '@tallysync/contracts'
import Link from 'next/link'
import { Action, AutoRefresh } from '@/components/Action'
import { OrderForm } from '@/components/OrderForm'
import { listRecords, nextNumber, objects } from '@/lib/repo'
import { items as itemOptions, names, parties as partyOptions } from '@/lib/masters'
import { statusCells } from '@/components/RecordStatus'
import { Badge, Table, fdate, fmt, ftime } from '@/lib/ui'
export const dynamic = 'force-dynamic'

export default async function Orders({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type = 'sales_order' } = await searchParams
  const masters = type === 'masters'
  const kind = type === 'purchase_order' ? 'purchase_order' : 'sales_order'
  const recs = masters ? listRecords().filter((r) => (MASTER_KINDS as readonly string[]).includes(r.entity)) : listRecords({ entity: kind })
  const parties = partyOptions(kind === 'sales_order' ? 'customers' : 'suppliers')
  return (<>
    <AutoRefresh seconds={8} />
    <h2>{masters ? 'Masters outbox' : kind === 'sales_order' ? 'Sales orders' : 'Purchase orders'}</h2>
    {masters ? <div className="card"><Action url="/api/demo-masters" label="Queue demo masters (units, godown, ledgers, GST, parties, items)" /></div>
      : <OrderForm kind={kind} defaultNumber={nextNumber(kind, kind === 'sales_order' ? 'SO' : 'PO')} parties={parties}
        items={itemOptions()} godowns={names('godown')} />}
    <div className="card">
      <Table empty="Nothing created yet." cols={masters ? [['Type'], ['Name'], ['Status'], ['Tally'], ['Updated'], ['']] : [['Number'], ['Date'], ['Party'], ['Lines', 'num'], ['Amount', 'num'], ['Status'], ['Tally'], ['Updated'], ['']]}
        rows={recs.map((r) => {
          const p = r.payload
          if (masters) return [r.entity, r.label, ...statusCells(r)]
          const amt = (p.lines ?? []).reduce((s: number, l: any) => s + l.qty * l.rate, 0)
          return [p.number, fdate(p.date), p.party, (p.lines ?? []).length, fmt(amt), ...statusCells(r)]
        })} />
    </div>
  </>)
}
