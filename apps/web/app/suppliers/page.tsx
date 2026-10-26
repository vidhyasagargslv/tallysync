import { PartyPage } from '@/components/PartyPage'
export const dynamic = 'force-dynamic'
export default async function Suppliers({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  return <PartyPage kind="suppliers" edit={(await searchParams).edit} />
}
