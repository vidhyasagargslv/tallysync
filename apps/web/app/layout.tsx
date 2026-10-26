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
        <div className="sec">Create (pushes to Tally)</div>
        <Link href="/customers">Customers</Link>
        <Link href="/suppliers">Suppliers</Link>
        <Link href="/items">Items</Link>
        <Link href="/orders?type=sales_order">Sales Orders</Link>
        <Link href="/orders?type=purchase_order">Purchase Orders</Link>
        <Link href="/orders?type=masters">All masters outbox</Link>
        <div className="sec">Tally data</div>
        <Link href="/stock">Stock</Link>
        <Link href="/ledgers">Ledgers</Link>
        <Link href="/vouchers">Vouchers</Link>
        <Link href="/reports">Reports (Outstanding, TB)</Link>
        <Link href="/masters">Masters</Link>
        <Link href="/schema">Schema explorer</Link>
        <div className="sec">System</div>
        <Link href="/log">Sync log</Link>
        <Link href="/mapping">Tally mapping</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      <main>{children}</main>
    </div></body></html>
  )
}
