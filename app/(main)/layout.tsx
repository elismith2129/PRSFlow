import { NavGate } from '@/components/layout/NavGate'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { WebInquiryProvider } from '@/components/notifications/WebInquiryProvider'
import { WebInquiryToaster } from '@/components/notifications/WebInquiryToaster'
import { SopGate } from '@/components/SopGate'
import TestingFloater from '@/components/dev/TestingFloater'
import DeviceToggle from '@/components/dev/DeviceToggle'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard>
      <WebInquiryProvider>
        {/* §14 frame: side rail left, content right (column-stacked on mobile,
            where NavGate renders a top bar instead — see .c-frame media query). */}
        <div className="c-frame">
          <NavGate />
          <main className="page-main" style={{ flex: 1, minWidth: 0, padding: '14px 20px 20px' }}>
            {children}
          </main>
        </div>
        {/* Site-wide Web Inquiry toasts — mounted at layout level so they appear
            on every internal page, independent of page content. */}
        <WebInquiryToaster />
        {/* First-login SOP gate — full-screen, blocks the app until acknowledged. */}
        <SopGate />
        {/* Floating test checklist — scoped to the INTERNAL app on purpose.
            Runner testing happens on a phone with the checklist open on a computer,
            so the panel has no business on /runner (it would only cover the phone-
            first UI being tested). Mounted here rather than the root layout also
            keeps it off /login, /register and /inquiry. Renders nothing unless the
            DEV → Testing PIN has been entered this browser session. */}
        <TestingFloater />
        {/* Owner-only floating phone/ipad preview button → /preview with the
            current page preloaded. Renders nothing for every other role. */}
        <DeviceToggle />
      </WebInquiryProvider>
    </AuthGuard>
  )
}
