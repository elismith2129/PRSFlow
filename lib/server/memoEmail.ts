// ─────────────────────────────────────────────────────────────────────────────
// lib/server/memoEmail — a memo as a newsletter (server only).
//
// Eli, 2026-09-15: "for these I'd also like it to be an email, like a
// newsletter, just for the owners and office admin… owners aren't on the app
// as much and I want them to see how much work goes into this."
//
// The email is deliberately NOT the designed page pasted into a mail body:
// mail clients strip CSS variables, color-mix, grid and most of what the
// designed pages are made of. Instead it is a clean, light, table-based
// newsletter (ivory paper, ink text, one green accent) carrying the title,
// who sent it, the memo's own lede, and one button — "Read the full memo" —
// to a login-free copy at /m/<token>. A typed note ('note' kind) rides
// inline in full, since its HTML is only bold and bullets.
//
// Signatures are not collected by email. The footer says so.
// ─────────────────────────────────────────────────────────────────────────────

export type MemoForMail = {
  id: string
  title: string
  kind: 'note' | 'page'
  body_html: string
  audience: 'admin' | 'runners' | 'everyone'
  requires_ack: boolean
  sent_by_name: string | null
  sent_at: string
  email_token: string
}

/** Who a memo mail goes to — the office, never runners (they sign in the app). */
export const MEMO_MAIL_ROLES = ['owner', 'manager', 'billing', 'asst_manager']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Server-side twin of components/shared/RichNote.sanitizeNote (which needs
 * DOMParser): keep b/strong/ul/ol/li/div/p/br with no attributes, drop
 * script/style bodies, unwrap everything else.
 */
export function sanitizeNoteServer(html: string): string {
  if (!html.includes('<')) return esc(html)
  let s = html.replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag: string) => {
    const t = tag.toLowerCase()
    const close = m.startsWith('</')
    if (['b', 'strong', 'ul', 'ol', 'li', 'div', 'p'].includes(t)) return close ? `</${t}>` : `<${t}>`
    if (t === 'br') return '<br>'
    return ''
  })
  return s
}

/** Plain text of any HTML — the mail's text part and the page's excerpt. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

/**
 * A designed page's own opening: its <h1> and the first paragraph after it
 * (the one-sheets carry a `.lede`). Falls back to the first ~320 chars.
 */
export function pageExcerpt(html: string): { heading: string | null; lede: string } {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const heading = h1 ? plainText(h1[1]) : null
  const after = h1 ? html.slice(h1.index + h1[0].length) : html.replace(/<style[\s\S]*?<\/style>/gi, '')
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(after)
  let lede = p ? plainText(p[1]) : plainText(after).slice(0, 320)
  if (lede.length > 420) lede = lede.slice(0, 400).replace(/\s+\S*$/, '') + '…'
  return { heading, lede }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
}

const AUD: Record<MemoForMail['audience'], string> = { admin: 'the office', runners: 'runners', everyone: 'everyone' }

export function buildMemoEmail(memo: MemoForMail, origin: string): { subject: string; html: string; text: string } {
  const link = `${origin}/m/${memo.email_token}`
  const appLink = `${origin}/memos`
  const from = memo.sent_by_name?.trim() || 'the office'
  const date = fmtDate(memo.sent_at)
  const subject = `Memo — ${memo.title}`

  let bodyHtml: string
  let bodyText: string
  if (memo.kind === 'note') {
    bodyHtml = `<div style="font-size:16px;line-height:1.6;color:#2a2722">${sanitizeNoteServer(memo.body_html)}</div>`
    bodyText = plainText(memo.body_html)
  } else {
    const { heading, lede } = pageExcerpt(memo.body_html)
    bodyHtml = `${heading && heading !== memo.title ? `<p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#2a2722">${esc(heading)}</p>` : ''}<p style="margin:0;font-size:16px;line-height:1.6;color:#2a2722">${esc(lede)}</p>`
    bodyText = [heading, lede].filter(Boolean).join('\n\n')
  }

  const button = (label: string, href: string, primary: boolean) =>
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto"><tr><td style="border-radius:999px;background:${primary ? '#2a2722' : '#e9e6df'}"><a href="${href}" style="display:inline-block;padding:13px 26px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${primary ? '#f5f3ee' : '#2a2722'};text-decoration:none">${label}</a></td></tr></table>`

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f3ee;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(bodyText.slice(0, 140))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f3ee"><tr><td align="center" style="padding:32px 16px 40px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">
  <tr><td style="padding:0 6px 14px;font-family:Inter,Helvetica,Arial,sans-serif">
    <span style="font-size:15px;font-weight:800;letter-spacing:-.02em;color:#2a2722">PRSFlo</span>
    <span style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8d8880;margin-left:10px">Memo</span>
    <span style="float:right;font-size:11px;color:#8d8880">${esc(date)}</span>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:18px;padding:30px 30px 26px;font-family:Inter,Helvetica,Arial,sans-serif;box-shadow:0 1px 2px rgba(42,39,34,.06)">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2fbf93">From ${esc(from)} · to ${AUD[memo.audience]}</p>
    <h1 style="margin:0 0 18px;font-size:27px;line-height:1.15;letter-spacing:-.02em;color:#2a2722;font-weight:800">${esc(memo.title)}</h1>
    ${bodyHtml}
    <div style="height:26px"></div>
    ${memo.kind === 'page' ? button('Read the full memo', link, true) : button('Open in PRSFlo', appLink, true)}
    ${memo.kind === 'page' ? `<p style="margin:12px 0 0;text-align:center;font-size:11.5px;color:#8d8880">Opens in your browser — no sign-in needed.</p>` : ''}
  </td></tr>
  <tr><td style="padding:18px 8px 0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.55;color:#8d8880">
    This is the read-along copy for owners and office admin. ${memo.requires_ack ? 'Signatures are collected in the app, not by replying here.' : 'Nothing to sign on this one.'}
    Sent from PRSFlo · Paramount Recording Studios.
  </td></tr>
</table>
</td></tr></table>
</body></html>`

  const text = `${memo.title}\nFrom ${from} · ${date} · to ${AUD[memo.audience]}\n\n${bodyText}\n\n${memo.kind === 'page' ? `Read the full memo: ${link}` : `Open in PRSFlo: ${appLink}`}\n\nRead-along copy for owners and office admin. ${memo.requires_ack ? 'Signatures are collected in the app.' : ''}`
  return { subject, html, text }
}

/** The login-free page at /m/<token>: the designed page as-is (stamped dark), or a typed note in a plain shell. */
export function renderPublicMemo(memo: Omit<MemoForMail, 'email_token'>): string {
  const from = memo.sent_by_name?.trim() || 'the office'
  const date = fmtDate(memo.sent_at)
  if (memo.kind === 'page') {
    const html = memo.body_html
    if (/<html[\s>]/i.test(html)) {
      return html.replace(/<html([^>]*)>/i, (m, attrs) => `<html${String(attrs).replace(/\sdata-theme="[^"]*"/i, '')} data-theme="dark">`)
    }
    return `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{background:#1b1a17;color-scheme:dark}</style></head><body>${html}</body></html>`
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(memo.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap">
<style>body{margin:0;background:#f5f3ee;color:#2a2722;font:400 16px/1.6 Inter,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:32px 18px 60px}
.card{max-width:640px;margin:0 auto;background:#fff;border-radius:18px;padding:30px;box-shadow:0 1px 2px rgba(42,39,34,.06),0 6px 18px rgba(42,39,34,.07)}
.k{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2fbf93;margin:0 0 6px}h1{font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:0 0 18px}
ul,ol{padding-left:22px}p,div{margin:0}.foot{max-width:640px;margin:16px auto 0;font-size:12px;color:#8d8880;padding:0 8px}</style></head>
<body><div class="card"><p class="k">From ${esc(from)} · ${esc(date)}</p><h1>${esc(memo.title)}</h1>${sanitizeNoteServer(memo.body_html)}</div>
<div class="foot">Read-along copy · PRSFlo · Paramount Recording Studios</div></body></html>`
}
