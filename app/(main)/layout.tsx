import { Nav } from '@/components/layout/Nav'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Nav />
      <main style={{ padding: '24px 32px' }}>
        {children}
      </main>
    </>
  )
}
