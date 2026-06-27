import { NavGate } from '@/components/layout/NavGate'
import { AuthGuard } from '@/components/auth/AuthGuard'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      <NavGate />
      <main className="page-main" style={{ padding: '24px 32px' }}>
        {children}
      </main>
    </AuthGuard>
  )
}
