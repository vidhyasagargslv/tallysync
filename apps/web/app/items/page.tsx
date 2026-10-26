import { AutoRefresh } from '@/components/Action'
import { ItemForm } from '@/components/MasterForms'
import { statusCells } from '@/components/RecordStatus'
import { loadMapping } from '@/lib/mapping'
import { names } from '@/lib/masters'
import { getRecord, listRecords, objects } from '@/lib/repo'
import { RawLink, Table, fmt } from '@/lib/ui'
export const dynamic = 'force-dynamic'

export default async function Items({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const editing = edit ? getRecord(edit) : null
  const local = listRecords({ entity: 'stock_item' })
  const localNames = new Set(local.map((r) => String(r.payload.name).toLowerCase()))
  const tally = new Map(objects('stock_item').map((i) => [i.name.toLowerCase(), i]))
  const tallyOnly = [...tally.values()].filter((i) => !localNames.has(i.name.toLowerCase()))
  return (<>
    <AutoRefresh seconds={10} />
    <h2>Items</h2>
    <ItemForm key={editing?.id ?? 'new'} initial={editing?.payload} editId={editing?.id} units={names('unit')} groups={names('stock_group')} godowns={names('godown')} defaultGroup={loadMapping().mapping?.groups.items ?? ''} />
    <div className="card"><h3 style={{ marginTop: 0 }}>Created here</h3>
      <Table empty="No items created yet." cols={[['Name'], ['Group'], ['Unit'], ['HSN/SAC'], ['GST %', 'num'], ['Opening', 'num'], ['Tally closing qty', 'num'], ['Status'], ['Tally'], ['Updated'], ['']]}
        rows={local.map((r) => {
          const p = r.payload
          const open = (p.openingBatches ?? []).reduce((s: number, b: any) => s + b.qty, 0) || p.openingQty || 0
          return [p.name, p.parent || 'Primary', p.baseUnit, p.hsn ?? '-', p.gstRate ?? '-', fmt(open), fmt(tally.get(String(p.name).toLowerCase())?.data?.closingQty), ...statusCells(r, `/items?edit=${r.id}`)]
        })} /></div>
    <div className="card"><h3 style={{ marginTop: 0 }}>Only in Tally (pulled)</h3>
      <Table empty="None." cols={[['Name'], ['Group'], ['Unit'], ['HSN'], ['GST %', 'num'], ['Closing qty', 'num'], ['']]}
        rows={tallyOnly.map((i) => [i.name, i.parent ?? '-', i.data?.baseUnits ?? '-', i.data?.hsn ?? '-', i.data?.gstRate ?? '-', fmt(i.data?.closingQty), <RawLink key="r" entity="stock_item" guid={i.guid} />])} /></div>
  </>)
}
