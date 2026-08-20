import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'
import ErrorReporter from '@/components/ErrorReporter'
import Toaster from '@/components/ui/Toaster'

export const metadata: Metadata = {
  title: 'PRSFlo',
  description: 'Paramount Recording Group Studio Management',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1b1a17',  // --c-bg dark. Was the legacy #0d0f14 blue-black.
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {/* Apply the saved theme before first paint (default: light). Runs on every
            route — including login/splash, which have no Nav to set data-theme.
            Runs BEFORE paint deliberately, so there's no flash of the wrong theme.

            DEFAULT IS DARK (Aug 6, 2026). Dark is the absence of data-theme, so
            this now sets 'light' ONLY when the user has explicitly chosen it.
            It used to be the reverse — light unless 'dark' was saved — which
            meant every new device and every cleared browser opened light.

            CLIENT-FACING PAGES ARE FORCED DARK: the public registration form
            (/register/:token) and the public enquiry form (/inquiry) are the only
            things an actual client ever sees, and they must look intentional rather
            than inheriting whichever theme a staff member last picked. Dark is the
            absence of data-theme, so we simply don't set it.

            /register/view/:clientId is EXCLUDED from that rule — it's a white print
            sheet used by staff to export a registration to PDF, not a client page.
            Forcing dark there would ruin the export. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=location.pathname;var clientFacing=(/^\\/register\\/(?!view(\\/|$))/.test(p)||/^\\/inquiry(\\/|$)/.test(p));if(!clientFacing){var t=localStorage.getItem('prsflo-theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light')}}}catch(e){}`,
          }}
        />
        <ErrorReporter />
        {children}
        <Toaster />
      </body>
    </html>
  )
}