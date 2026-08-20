import type { Metadata } from 'next'

// SERVER-COMPONENT PASSTHROUGH, exactly like app/runner/layout.tsx: it exists
// only to carry metadata for the /register/* subtree. No markup of its own.
//
// WHY (Eli, 2026-08-19): registration links get TEXTED to clients, and the
// iMessage/WhatsApp link preview showed "PRSFlo · prs-flow.vercel.app" — an
// internal product name meaning nothing to the client receiving it. The
// preview reads the page title / og:title, so the subtree overrides both.
// (The URL line under the title is the domain and cannot be renamed here.)
export const metadata: Metadata = {
  title: 'Paramount Client Registration',
  description: 'Client registration for Paramount Recording Studios.',
  openGraph: {
    title: 'Paramount Client Registration',
    description: 'Client registration for Paramount Recording Studios.',
    siteName: 'Paramount Recording Studios',
  },
}

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
