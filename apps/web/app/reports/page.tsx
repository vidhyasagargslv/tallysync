import { report } from '@/lib/repo'
import { Table, fmt } from '@/lib/ui'
export const dynamic = 'force-dynamic'
export default function Reports() {
  const os = report('outstanding') as any[]
  const tb = report('trial-balance') as any
  return (<><h2>Outstanding</h2>
    <div className="cards"><div className="stat"><span className="muted">Receivable</span><b>{fmt(os.filter((o) => o.side === 'receivable').reduce((s, o) => s + o.amount, 0))}</b></div>
      <div className="stat"><span className="muted">Payable</span><b>{fmt(os.filter((o) => o.side === 'payable').reduce((s, o) => s + o.amount, 0))}</b></div></div>
    <Table cols={[['Ledger'], ['Group'], ['Side'], ['Amount', 'num']]} rows={os.map((o) => [o.ledger, o.group, o.side, fmt(o.amount)])} />
    <h2 style={{ marginTop: 28 }}>Trial balance</h2>
    <Table cols={[['Ledger'], ['Group'], ['Debit', 'num'], ['Credit', 'num']]}
      rows={[...tb.rows.map((r: any) => [r.ledger, r.group, fmt(r.debit), fmt(r.credit)]), tb.rows.length ? [<b key="t">Total</b>, '', <b key="d">{fmt(tb.totalDebit)}</b>, <b key="c">{fmt(tb.totalCredit)}</b>] : []].filter((r) => r.length)} /></>)
}
