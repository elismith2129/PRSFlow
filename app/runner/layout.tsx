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

export default function RunnerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
