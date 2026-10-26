import Link from 'next/link'
import { Action } from './Action'
import { Badge, ftime } from '@/lib/ui'

/** Status cells shared by every outbox list: status + error, Tally ref, updated, actions. */
export function statusCells(r: any, editHref?: string) {
  return [
    <span key="s"><Badge s={r.status} />{r.error && <div className={r.status === 'failed' ? 'err' : 'muted'}>{r.error}</div>}</span>,
    r.tallyGuid ? <span key="t" title={r.tallyGuid}>{r.action}{r.voucherNumber ? ` #${r.voucherNumber}` : ''}</span> : '-',
    ftime(r.updatedAt),
    <span key="a">{r.status === 'failed' && <Action url={`/api/records/${r.id}/retry`} label="Retry" secondary />} {editHref && <Link href={editHref}>edit</Link>} <Link href={`/api/records/${r.id}`}>xml</Link></span>
  ]
}
