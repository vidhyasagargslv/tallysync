import Link from 'next/link'
import type { ReactNode } from 'react'

export const fmt = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n == null ? '-' : String(n))
export const fdate = (d: unknown) => { const s = String(d ?? ''); return /^\d{8}$/.test(s) ? `${s.slice(6)}-${s.slice(4, 6)}-${s.slice(0, 4)}` : s || '-' }
export const ftime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-IN') : '-')
export const Badge = ({ s }: { s: string }) => <span className={`badge ${s}`}>{s}</span>
export const RawLink = ({ entity, guid, children }: { entity: string; guid: string; children?: ReactNode }) =>
  <Link href={`/raw/${entity}/${encodeURIComponent(guid)}`}>{children ?? 'raw'}</Link>
export function Table({ cols, rows, empty = 'No data yet. Run a sync from the agent.' }: { cols: Array<[string, string?]>; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>
  return <table><thead><tr>{cols.map(([c, cls], i) => <th key={i} className={cls}>{c}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cols[j]?.[1]}>{c}</td>)}</tr>)}</tbody></table>
}
