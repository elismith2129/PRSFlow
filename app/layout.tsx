import type { Metadata } from 'next'
import '@/styles/globals.css'
import { Nav } from '@/components/layout/Nav'

export const metadata: Metadata = {
  title: 'PRSFlow',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ background: 'var(--bg)', minHeight: '100vh' }}>
        <Nav />
        <main style={{ padding: '24px 32px' }}>
          {children}
        </main>
      </body>
    </html>
  )
}