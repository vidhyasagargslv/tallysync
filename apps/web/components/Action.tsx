'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/** Button that calls an API route and refreshes the page. */
export function Action({ url, method = 'POST', label, secondary, confirm: ask }: { url: string; method?: string; label: string; secondary?: boolean; confirm?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <span>
      <button className={secondary ? 'secondary' : ''} disabled={busy} onClick={async () => {
        if (ask && !window.confirm(ask)) return
        setBusy(true); setMsg('')
        const r = await fetch(url, { method })
        if (!r.ok) setMsg((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        setBusy(false); router.refresh()
      }}>{busy ? '...' : label}</button>
      {msg && <span className="err"> {msg}</span>}
    </span>
  )
}

export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => { const t = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(t) }, [router, seconds])
  return null
}
