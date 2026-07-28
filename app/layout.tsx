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
  themeColor: '#0d0f14',
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
            route — including login/splash, which have no Nav to set data-theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('prsflo-theme');if(t!=='dark'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}`,
          }}
        />
        <ErrorReporter />
        {children}
        <Toaster />
      </body>
    </html>
  )
}