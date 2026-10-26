'use client'
import { useState } from 'react'
export function ApiKey({ initial }: { initial: string }) {
  const [key, setKey] = useState(initial)
  const [show, setShow] = useState(false)
  return (
    <div className="row">
      <code style={{ padding: 8, background: '#f0f3f9', borderRadius: 6 }}>{show ? key : key.slice(0, 6) + '•'.repeat(20)}</code>
      <button className="secondary" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
      <button onClick={async () => {
        if (!confirm('Regenerate? The agent stops syncing until you paste the new key into it.')) return
        const r = await fetch('/api/settings/api-key', { method: 'POST' }); setKey((await r.json()).apiKey); setShow(true)
      }}>Regenerate</button>
    </div>
  )
}
