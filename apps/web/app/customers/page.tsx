import { PartyPage } from '@/components/PartyPage'
export const dynamic = 'force-dynamic'
export default async function Customers({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  return <PartyPage kind="customers" edit={(await searchParams).edit} />
}
