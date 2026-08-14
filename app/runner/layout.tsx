import type { Metadata } from 'next'

export const metadata: Metadata = {
  manifest: '/runner-manifest.json',
  icons: {
    apple: '/runner-apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Runner',
  },
}

import AdminReturn from '@/components/runner/AdminReturn'

export default function RunnerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // AdminReturn renders nothing for runners and the public — see the component.
  return <><AdminReturn />{children}</>
}
