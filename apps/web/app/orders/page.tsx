import { MASTER_KINDS } from '@tallysync/contracts'
import Link from 'next/link'
import { Action, AutoRefresh } from '@/components/Action'
import { OrderForm } from '@/components/OrderForm'
import { listRecords, nextNumber, objects } from '@/lib/repo'
import { items as itemOptions, names, parties as partyOptions } from '@/lib/masters'
import { statusCells } from '@/components/RecordStatus'
import { Badge, Table, fdate, fmt, ftime } from '@/lib/ui'
export const dynamic = 'force-dynamic'

const KINDS = ['sales_order', 'purchase_order', 'credit_note', 'debit_note'] as const
type Kind = (typeof KINDS)[number]
const META: Record<Kind, { title: string; prefix: string; side: 'customers' | 'suppliers'; note: boolean }> = {
  sales_order: { title: 'Sales orders', prefix: 'SO', side: 'customers', note: false },
  purchase_order: { title: 'Purchase orders', prefix: 'PO', side: 'suppliers', note: false },
  credit_note: { title: 'Credit notes (sales returns)', prefix: 'CN', side: 'customers', note: true },
  debit_note: { title: 'Debit notes (purchase returns)', prefix: 'DN', side: 'suppliers', note: true }
}

export default async function Orders({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type = 'sales_order' } = await searchParams
  const masters = type === 'masters'
  const kind = (KINDS as readonly string[]).includes(type) ? (type as Kind) : 'sales_order'
  const meta = META[kind]
  const recs = masters ? listRecords().filter((r) => (MASTER_KINDS as readonly string[]).includes(r.entity)) : listRecords({ entity: kind })
  const parties = partyOptions(meta.side)
  return (<>
    <AutoRefresh seconds={8} />
    <h2>{masters ? 'Masters outbox' : meta.title}</h2>
    {masters ? <div className="card"><Action url="/api/demo-masters" label="Queue demo masters (units, godown, ledgers, GST, parties, items)" /></div>
      : <OrderForm kind={kind} defaultNumber={nextNumber(kind, meta.prefix)} parties={parties}
        items={itemOptions()} godowns={names('godown')} />}
    <div className="card">
      <Table empty="Nothing created yet." cols={masters ? [['Type'], ['Name'], ['Status'], ['Tally'], ['Updated'], ['']] : [['Number'], ['Date'], ['Party'], ...(meta.note ? [['Against invoice'] as [string]] : []), ['Lines', 'num'], ['Amount', 'num'], ['Status'], ['Tally'], ['Updated'], ['']]}
        rows={recs.map((r) => {
          const p = r.payload
          if (masters) return [r.entity, r.label, ...statusCells(r)]
          const amt = (p.lines ?? []).reduce((s: number, l: any) => s + l.qty * l.rate, 0)
          return [p.number, fdate(p.date), p.party, ...(meta.note ? [p.againstInvoice ?? '-'] : []), (p.lines ?? []).length, fmt(amt), ...statusCells(r)]
        })} />
    </div>
  </>)
}
