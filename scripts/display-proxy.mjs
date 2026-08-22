// PRSFlo TV display proxy — run one of these per studio building.
//
// WHY THIS EXISTS
// The wall panels are Sharp PN-B401s on Android 4.4.2. They cannot complete a
// TLS handshake with Vercel: every Vercel certificate chains to Let's Encrypt's
// ISRG Root X1, which Android only trusts from 7.1.1 onward, and the ISRG root
// installed by hand on the panel did NOT take — Sharp's HTML5 Browser ignores
// user-installed CAs. Verified 2026-08-19 on Encore B against Let's Encrypt's
// own valid-isrgrootx1.letsencrypt.org test page.
//
// The existing WordPress calendars work on those same panels because they are
// served over plain http:// with no certificate in the path. So: this proxy
// speaks plain HTTP to the TVs on the local network, and does the HTTPS to
// Vercel itself, where a modern TLS stack is available.
//
// That browser renders NO error page — any failed request is simply a white
// screen. So this proxy always answers with something, even when upstream is
// down, or a dead wall gives no clue why.
//
// RUN:   node scripts/display-proxy.mjs
// THEN:  point each TV at  http://<this machine's IP>:8080/<room-slug>
//        e.g. http://192.168.1.50:8080/ers-b
//
// Port 8080, not 80, so it needs no sudo. Nothing is written to disk and no
// credentials live here — it only forwards public display URLs.
import http from 'http'
import os from 'os'

const UPSTREAM = process.env.DISPLAY_UPSTREAM || 'https://prsflow.paramountrecording.com'
const PORT = Number(process.env.PORT || 8080)

const BG = '#1b1a17'
const FG = '#d9d6cd'

function notice(msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="refresh" content="15">`
    + `<title>Display</title></head>`
    + `<body style="background:${BG};color:${FG};font-family:Helvetica,Arial,sans-serif;margin:0">`
    + `<div style="padding:40px;font-size:34px">${msg}</div></body></html>`
}

const server = http.createServer(async (req, res) => {
  // "/ers-b?probe=1" -> room "ers-b", query preserved so the page's own
  // auto-refresh probe passes straight through.
  const [rawPath, query] = req.url.split('?')
  const room = decodeURIComponent(rawPath.replace(/^\/+|\/+$/g, ''))

  if (!room || room === 'favicon.ico') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(notice('Add a room to the address, e.g. /ers-b'))
  }

  const target = `${UPSTREAM}/display/${encodeURIComponent(room)}${query ? '?' + query : ''}`

  try {
    const upstream = await fetch(target, {
      headers: { 'user-agent': 'prsflo-display-proxy' },
      signal: AbortSignal.timeout(20000),
    })
    const body = await upstream.text()
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
      // The panels cache hard. Never let a wall freeze on a stale copy.
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
    })
    res.end(body)
  } catch (err) {
    // Answer with a readable message, never a white screen. The 15s meta
    // refresh in notice() means the wall recovers by itself once upstream is
    // back — nobody has to walk to the studio.
    console.error(`[${new Date().toISOString()}] ${room}: ${err.message}`)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(notice('Reconnecting&hellip;'))
  }
})

function lanAddresses() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) out.push(nic.address)
    }
  }
  return out
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses()
  console.log('')
  console.log('  PRSFlo display proxy is running.')
  console.log(`  Forwarding to ${UPSTREAM}`)
  console.log('')
  console.log('  Point each TV at one of these:')
  for (const ip of ips.length ? ips : ['<this machine IP>']) {
    console.log(`    http://${ip}:${PORT}/ers-b`)
  }
  console.log('')
  console.log('  Leave this window open. Ctrl-C stops it.')
  console.log('')
})
