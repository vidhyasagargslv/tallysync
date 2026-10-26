import { syncLogRows } from '@/lib/repo'
import { Badge, Table, ftime } from '@/lib/ui'
export const dynamic = 'force-dynamic'
export default function Log() {
  return (<><h2>Sync log</h2>
    <Table cols={[['Time'], ['Kind'], ['Entity'], ['Status'], ['Message']]} rows={syncLogRows(300).map((l) => [ftime(l.at), l.kind, l.entity ?? '-', <Badge key="s" s={l.status} />, l.message])} /></>)
}
