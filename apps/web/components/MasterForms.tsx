'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']

async function save(entity: string, payload: unknown, editId?: string) {
  const r = await fetch(editId ? `/api/records/${editId}` : '/api/records', {
    method: editId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(editId ? payload : { entity, payload })
  })
  if (r.ok) return ''
  const j = await r.json().catch(() => ({}))
  return j.issues ? j.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') : j.error ?? `HTTP ${r.status}`
}
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && !(typeof v === 'number' && isNaN(v))))

export function PartyForm({ kind, group, initial, editId, base }: { kind: 'customer' | 'supplier'; group: string; initial?: any; editId?: string; base: string }) {
  const router = useRouter()
  const i = initial ?? {}
  const [f, setF] = useState<Record<string, string>>({
    name: i.name ?? '', gstRegistrationType: i.gstRegistrationType ?? (i.gstin ? 'Regular' : 'Unregistered'), gstin: i.gstin ?? '', state: i.state ?? '', address: i.address ?? '',
    pincode: i.pincode ?? '', phone: i.phone ?? '', email: i.email ?? '', openingBalance: i.openingBalance === undefined ? '' : String(i.openingBalance)
  })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true)
      const msg = await save('ledger', clean({ ...f, parent: group, billWise: true, gstin: f.gstin.toUpperCase(), openingBalance: f.openingBalance === '' ? undefined : Number(f.openingBalance) }), editId)
      setBusy(false); setErr(msg)
      if (!msg) { if (!editId) setF({ ...f, name: '', gstin: '', address: '', pincode: '', phone: '', email: '', openingBalance: '' }); router.push(base); router.refresh() }
    }}>
      <h3 style={{ marginTop: 0 }}>{editId ? `Edit ${kind} (pushes as Alter)` : `New ${kind}`} <span className="muted">under group “{group}”</span></h3>
      <div className="row">
        <label>Name<input value={f.name} onChange={set('name')} required readOnly={!!editId} style={{ width: 220 }} /></label>
        <label>GST registration<select value={f.gstRegistrationType} onChange={set('gstRegistrationType')}>{['Regular', 'Composition', 'Unregistered', 'Consumer'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>GSTIN<input value={f.gstin} onChange={set('gstin')} maxLength={15} placeholder="29ABCDE1234F1Z5" style={{ width: 170 }} /></label>
        <label>State<select value={f.state} onChange={set('state')}><option value="">-</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Address<input value={f.address} onChange={set('address')} style={{ width: 300 }} /></label>
        <label>Pincode<input value={f.pincode} onChange={set('pincode')} style={{ width: 90 }} /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} style={{ width: 130 }} /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} /></label>
        <label>Opening balance (Dr +, Cr -)<input type="number" step="any" value={f.openingBalance} onChange={set('openingBalance')} style={{ width: 120 }} /></label>
        <button disabled={busy}>{busy ? 'Saving...' : editId ? 'Save & push' : 'Save & queue for Tally'}</button>
        {editId && <button type="button" className="secondary" onClick={() => router.push(base)}>Cancel</button>}
      </div>
      {err && <p className="err">{err}</p>}
    </form>
  )
}

export function ItemForm({ initial, editId, units, groups, godowns, defaultGroup }: { initial?: any; editId?: string; units: string[]; groups: string[]; godowns: string[]; defaultGroup: string }) {
  const router = useRouter()
  const i = initial ?? {}
  const [f, setF] = useState<Record<string, string>>({ name: i.name ?? '', baseUnit: i.baseUnit ?? 'Nos', parent: i.parent ?? defaultGroup, hsn: i.hsn ?? '', gstRate: i.gstRate === undefined ? '18' : String(i.gstRate), typeOfSupply: i.typeOfSupply ?? 'Goods' })
  const [batches, setBatches] = useState<Array<{ godown: string; qty: string; rate: string }>>(
    (i.openingBatches ?? (i.openingQty ? [{ godown: i.godown ?? 'Main Location', qty: i.openingQty, rate: i.openingRate ?? 0 }] : [])).map((b: any) => ({ godown: b.godown, qty: String(b.qty), rate: String(b.rate) })))
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const setB = (j: number, k: 'godown' | 'qty' | 'rate', v: string) => setBatches(batches.map((x, n) => (n === j ? { ...x, [k]: v } : x)))
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true)
      const ob = batches.filter((b) => b.godown && Number(b.qty)).map((b) => ({ godown: b.godown, qty: Number(b.qty), rate: Number(b.rate || 0) }))
      const msg = await save('stock_item', clean({ ...f, gstRate: f.gstRate === '' ? undefined : Number(f.gstRate), openingBatches: ob.length ? ob : undefined }), editId)
      setBusy(false); setErr(msg)
      if (!msg) { if (!editId) { setF({ ...f, name: '', hsn: '' }); setBatches([]) } router.push('/items'); router.refresh() }
    }}>
      <h3 style={{ marginTop: 0 }}>{editId ? 'Edit item (pushes as Alter)' : 'New item'}</h3>
      <datalist id="units">{units.map((u) => <option key={u} value={u} />)}</datalist>
      <datalist id="sgroups">{groups.map((u) => <option key={u} value={u} />)}</datalist>
      <datalist id="godowns">{godowns.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="row">
        <label>Name<input value={f.name} onChange={set('name')} required readOnly={!!editId} style={{ width: 220 }} /></label>
        <label>Unit<input list="units" value={f.baseUnit} onChange={set('baseUnit')} required style={{ width: 90 }} /></label>
        <label>Stock group (blank = Primary)<input list="sgroups" value={f.parent} onChange={set('parent')} /></label>
        <label>Type<select value={f.typeOfSupply} onChange={set('typeOfSupply')}><option>Goods</option><option>Services</option></select></label>
        <label>{f.typeOfSupply === 'Services' ? 'SAC' : 'HSN'}<input value={f.hsn} onChange={set('hsn')} style={{ width: 100 }} /></label>
        <label>GST %<select value={f.gstRate} onChange={set('gstRate')}>{['0', '0.25', '3', '5', '12', '18', '28'].map((r) => <option key={r}>{r}</option>)}</select></label>
      </div>
      <h4 style={{ margin: '12px 0 6px' }}>Opening stock per godown (optional)</h4>
      {batches.map((b, j) => (
        <div className="row" key={j} style={{ marginBottom: 6 }}>
          <label>Godown<input list="godowns" value={b.godown} onChange={(e) => setB(j, 'godown', e.target.value)} /></label>
          <label>Qty<input type="number" step="any" value={b.qty} onChange={(e) => setB(j, 'qty', e.target.value)} style={{ width: 90 }} /></label>
          <label>Rate<input type="number" step="any" value={b.rate} onChange={(e) => setB(j, 'rate', e.target.value)} style={{ width: 100 }} /></label>
          <button type="button" className="secondary" onClick={() => setBatches(batches.filter((_, k) => k !== j))}>x</button>
        </div>))}
      <div className="row">
        <button type="button" className="secondary" onClick={() => setBatches([...batches, { godown: godowns[0] ?? 'Main Location', qty: '0', rate: '0' }])}>+ Godown</button>
        <button disabled={busy}>{busy ? 'Saving...' : editId ? 'Save & push' : 'Save & queue for Tally'}</button>
        {editId && <button type="button" className="secondary" onClick={() => router.push('/items')}>Cancel</button>}
      </div>
      {err && <p className="err">{err}</p>}
    </form>
  )
}
