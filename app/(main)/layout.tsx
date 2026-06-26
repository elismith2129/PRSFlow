import { Nav } from '@/components/layout/Nav'
import { AuthGuard } from '@/components/auth/AuthGuard'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      <Nav />
      <main className="page-main" style={{ padding: '24px 32px' }}>
        {children}
      </main>
    </AuthGuard>
  )
}
