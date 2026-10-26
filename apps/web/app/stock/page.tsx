import { objects, report } from '@/lib/repo'
import { RawLink, Table, fmt } from '@/lib/ui'
export const dynamic = 'force-dynamic'
export default function Stock() {
  const rows = report('stock') as any[]
  const items = objects('stock_item')
  return (<>
    <h2>Stock</h2>
    <h3>By item (Tally closing)</h3>
    <Table cols={[['Item'], ['Group'], ['Unit'], ['HSN'], ['GST %', 'num'], ['Closing qty', 'num'], ['Closing value', 'num'], ['']]}
      rows={items.map((i) => [i.name, i.parent ?? '-', i.data?.baseUnits ?? '-', i.data?.hsn ?? '-', i.data?.gstRate ?? '-', fmt(i.data?.closingQty), fmt(i.data?.closingValue == null ? null : Math.abs(i.data.closingValue)), <RawLink key="r" entity="stock_item" guid={i.guid} />])} />
    <h3>By item and godown (computed from openings + vouchers, orders excluded)</h3>
    <Table cols={[['Item'], ['Godown'], ['Qty', 'num'], ['Unit'], ['Value', 'num']]}
      rows={rows.filter((r) => r.source === 'computed').map((r) => [r.item, r.godown, fmt(r.qty), r.unit ?? '-', fmt(r.value)])} />
  </>)
}
