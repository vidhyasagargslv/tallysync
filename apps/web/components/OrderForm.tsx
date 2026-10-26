'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Line { item: string; qty: string; rate: string; godown: string; gstRate: string }
const empty: Line = { item: '', qty: '1', rate: '0', godown: '', gstRate: '18' }

export function OrderForm({ kind, defaultNumber, parties, items, godowns }: { kind: 'sales_order' | 'purchase_order'; defaultNumber: string; parties: string[]; items: string[]; godowns: string[] }) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)
  const [number, setNumber] = useState(defaultNumber)
  const [date, setDate] = useState(today)
  const [party, setParty] = useState('')
  const [taxMode, setTaxMode] = useState('intra')
  const [narration, setNarration] = useState('')
  const [lines, setLines] = useState<Line[]>([{ ...empty }])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.rate) * (taxMode === 'none' ? 1 : 1 + Number(l.gstRate || 0) / 100), 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const payload = {
      number, date: date.replaceAll('-', ''), party, taxMode, narration: narration || undefined,
      lines: lines.filter((l) => l.item).map((l) => ({ item: l.item, qty: Number(l.qty), rate: Number(l.rate), godown: l.godown || undefined, gstRate: taxMode === 'none' ? undefined : Number(l.gstRate) }))
    }
    const r = await fetch('/api/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entity: kind, payload }) })
    setBusy(false)
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.issues ? j.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') : j.error ?? `HTTP ${r.status}`); return }
    setLines([{ ...empty }]); setParty(''); setNarration('')
    router.refresh()
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>New {kind === 'sales_order' ? 'sales order' : 'purchase order'}</h3>
      <datalist id="parties">{parties.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="items">{items.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="godowns">{godowns.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="row">
        <label>Number<input value={number} onChange={(e) => setNumber(e.target.value)} required /></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Party ledger<input list="parties" value={party} onChange={(e) => setParty(e.target.value)} required style={{ width: 220 }} /></label>
        <label>GST<select value={taxMode} onChange={(e) => setTaxMode(e.target.value)}><option value="intra">Intra-state (CGST+SGST)</option><option value="inter">Inter-state (IGST)</option><option value="none">No GST</option></select></label>
        <label>Narration<input value={narration} onChange={(e) => setNarration(e.target.value)} /></label>
      </div>
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Godown</th><th>GST %</th><th className="num">Amount</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}>
            <td><input list="items" value={l.item} onChange={(e) => set(i, 'item', e.target.value)} required={i === 0} /></td>
            <td><input type="number" step="any" min="0" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} style={{ width: 80 }} /></td>
            <td><input type="number" step="any" min="0" value={l.rate} onChange={(e) => set(i, 'rate', e.target.value)} style={{ width: 100 }} /></td>
            <td><input list="godowns" value={l.godown} onChange={(e) => set(i, 'godown', e.target.value)} placeholder="Main Location" /></td>
            <td><input type="number" step="any" value={l.gstRate} onChange={(e) => set(i, 'gstRate', e.target.value)} style={{ width: 60 }} disabled={taxMode === 'none'} /></td>
            <td className="num">{(Number(l.qty) * Number(l.rate)).toFixed(2)}</td>
            <td>{lines.length > 1 && <button type="button" className="secondary" onClick={() => setLines(lines.filter((_, j) => j !== i))}>x</button>}</td>
          </tr>))}</tbody>
      </table>
      <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <button type="button" className="secondary" onClick={() => setLines([...lines, { ...empty }])}>+ Line</button>
        <span>Total incl. GST: <b>{total.toFixed(2)}</b> <button disabled={busy}>{busy ? 'Saving...' : 'Save & queue for Tally'}</button></span>
      </div>
      {err && <p className="err">{err}</p>}
    </form>
  )
}
