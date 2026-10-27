import Link from 'next/link'
import { report } from '@/lib/repo'
import { RawLink, Table, fdate, fmt } from '@/lib/ui'
export const dynamic = 'force-dynamic'
const CATS = [['', 'All'], ['sales', 'Sales'], ['purchase', 'Purchases'], ['sales_order', 'Sales orders'], ['purchase_order', 'Purchase orders'], ['receipt', 'Receipts'], ['payment', 'Payments'], ['credit_note', 'Credit notes'], ['debit_note', 'Debit notes'], ['other', 'Other']]
export default async function Vouchers({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category = '' } = await searchParams
  const rows = report('vouchers', category || null) as any[]
  return (<><h2>Vouchers from Tally</h2>
    <p className="tabs">{CATS.map(([k, l]) => <Link key={k} href={`/vouchers${k ? `?category=${k}` : ''}`} className={k === category ? 'on' : ''}>{l}</Link>)}</p>
    <Table cols={[['Date'], ['Type'], ['Number'], ['Party'], ['Amount', 'num'], ['Items'], ['Narration'], ['']]}
      rows={rows.map((v) => [fdate(v.date), v.voucherType, v.voucherNumber, v.party ?? '-', fmt(v.amount),
        (v.inventoryEntries ?? []).map((e: any) => `${e.item} x${e.qty}${e.godown ? ` @${e.godown}` : ''}`).join(', ') || '-', v.narration ?? '', <RawLink key="r" entity="voucher" guid={v.guid} />])} /></>)
}
