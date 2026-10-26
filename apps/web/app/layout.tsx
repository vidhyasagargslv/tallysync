import './globals.css'
import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata = { title: 'TallySync' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en"><body><div className="shell">
      <nav className="nav">
        <h1>TallySync</h1>
        <Link href="/">Dashboard</Link>
        <div className="sec">To Tally</div>
        <Link href="/orders?type=sales_order">Sales orders</Link>
        <Link href="/orders?type=purchase_order">Purchase orders</Link>
        <Link href="/orders?type=masters">Masters outbox</Link>
        <div className="sec">From Tally</div>
        <Link href="/stock">Stock</Link>
        <Link href="/ledgers">Ledgers</Link>
        <Link href="/vouchers?category=sales">Sales</Link>
        <Link href="/vouchers?category=purchase">Purchases</Link>
        <Link href="/vouchers">All vouchers</Link>
        <Link href="/reports">Outstanding &amp; TB</Link>
        <Link href="/masters">Masters</Link>
        <Link href="/schema">Schema explorer</Link>
        <div className="sec">System</div>
        <Link href="/log">Sync log</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      <main>{children}</main>
    </div></body></html>
  )
}
