import { NavGate } from '@/components/layout/NavGate'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { WebInquiryProvider } from '@/components/notifications/WebInquiryProvider'
import { WebInquiryToaster } from '@/components/notifications/WebInquiryToaster'
import { SopGate } from '@/components/SopGate'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      <WebInquiryProvider>
        <NavGate />
        <main className="page-main" style={{ padding: '24px 32px' }}>
          {children}
        </main>
        {/* Site-wide Web Inquiry toasts — mounted at layout level so they appear
            on every internal page, independent of page content. */}
        <WebInquiryToaster />
        {/* First-login SOP gate — full-screen, blocks the app until acknowledged. */}
        <SopGate />
      </WebInquiryProvider>
    </AuthGuard>
  )
}
