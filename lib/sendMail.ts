// ─────────────────────────────────────────────────────────────────────────────
// Transactional email — server only.
//
// Deliberately a plain `fetch` to the Resend REST API rather than the `resend`
// npm package: one less dependency to install and keep patched, and nothing here
// needs the SDK's extra surface. Swapping providers means editing this file only.
//
// WHY THIS EXISTS: the inquiry form used to live on Squarespace and emailed the
// team, so a new lead arrived as a phone notification. Moving it into PRSFlo
// removed that — the lead lands in the CRM and nothing tells anyone. Web push is
// the eventual answer; this restores the alert that was lost, using a channel
// every phone already notifies on.
//
// FAILURE IS ALWAYS SOFT. Callers must not let a mail failure fail their own
// work — a lead that saved but didn't email is a missed notification; a lead that
// failed to save because the mail server was down is a lost customer.
// ─────────────────────────────────────────────────────────────────────────────

const API = 'https://api.resend.com/emails'

/** The one verified sender for this domain. Lived as a private const inside
 *  `/api/send-campaign`; hoisted here so there is a single place to change it
 *  when the sending domain moves. Override per-environment with MAIL_FROM. */
export const MAIL_FROM_DEFAULT = 'Paramount Recording Studios <info@paramountrecording.com>'

export type MailResult = { ok: true } | { ok: false; reason: string }

export async function sendMail(opts: {
  to: string | string[]
  subject: string
  html: string
  /** Plain-text fallback. Worth setting — some spam filters score HTML-only mail. */
  text?: string
  replyTo?: string
}): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM || MAIL_FROM_DEFAULT

  // Missing key is not an error worth throwing: local dev and preview
  // deployments have no key, and the calling feature must still work there.
  if (!key) {
    console.warn('[mail] skipped — RESEND_API_KEY not set')
    return { ok: false, reason: 'not configured' }
  }

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        // Lets staff hit Reply and land in the customer's inbox rather than a
        // noreply address — the whole point of an inquiry alert.
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[mail] send failed:', res.status, detail.slice(0, 400))
      return { ok: false, reason: `http ${res.status}` }
    }
    return { ok: true }
  } catch (e: any) {
    console.error('[mail] send threw:', e?.message ?? e)
    return { ok: false, reason: 'network' }
  }
}

/** Escape user-supplied text before it goes into an HTML email body. */
export function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
