import { objects } from '@/lib/repo'
import { RawLink, Table, fmt } from '@/lib/ui'
export const dynamic = 'force-dynamic'
export default function Ledgers() {
  return (<><h2>Ledgers</h2>
    <Table cols={[['Name'], ['Group'], ['GSTIN'], ['State'], ['Opening', 'num'], ['Closing (Dr -, Cr +)', 'num'], ['']]}
      rows={objects('ledger').map((l) => [l.name, l.parent ?? '-', l.data?.gstin ?? '-', l.data?.state ?? '-', fmt(l.data?.openingBalance), fmt(l.data?.closingBalance), <RawLink key="r" entity="ledger" guid={l.guid} />])} /></>)
}
