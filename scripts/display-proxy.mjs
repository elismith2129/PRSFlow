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

// ── THE SHARED PROBE (Eli, 2026-11-11) ──────────────────────────────────────
// Each panel asks "has my room changed?" every 15s (?probe=1). Forwarding every
// one of those to Vercel was ~63k calls a day across the walls and is what
// tripped Vercel's abuse firewall on 2026-11-11 (every wall went 503). Now this
// proxy fetches ONE page listing every room's hash every PROBE_MS, keeps it
// here, and answers the panels from memory. Vercel sees one call per building
// per 10s. The page itself is never cached — only the probe answer — so a
// reload always draws the live wall.
//
// If the upstream probe has not succeeded for STALE_MS, a panel is answered
// with the last hash it was told (so an outage does not make eleven walls
// reload every 15s), or 'unavailable' when nothing is known yet — which makes
// the panel reload once into the Reconnecting notice and wait there.
const PROBE_MS = Number(process.env.PROBE_MS || 10000)
const STALE_MS = 60000
let probeCache = { hashes: {}, at: 0, key: '' }

async function refreshProbe() {
  try {
    const url = `${UPSTREAM}/display/probe${probeCache.key ? '?k=' + encodeURIComponent(probeCache.key) : ''}`
    const r = await fetch(url, { headers: { 'user-agent': 'prsflo-display-proxy' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`upstream ${r.status}`)
    const j = await r.json()
    probeCache = { ...probeCache, hashes: j, at: Date.now() }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] probe: ${err.message}`)
  }
}
setInterval(refreshProbe, PROBE_MS)
refreshProbe()

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

  // A panel's probe is answered from the shared cache, never forwarded.
  const params = new URLSearchParams(query || '')
  if (params.get('probe')) {
    const k = params.get('k')
    if (k && k !== probeCache.key) { probeCache.key = k; refreshProbe() }
    const fresh = Date.now() - probeCache.at < STALE_MS
    const h = probeCache.hashes[room]
    const body = fresh && h ? h : (h || 'unavailable')
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(body)
  }

  const target = `${UPSTREAM}/display/${encodeURIComponent(room)}${query ? '?' + query : ''}`

  try {
    const upstream = await fetch(target, {
      headers: { 'user-agent': 'prsflo-display-proxy' },
      signal: AbortSignal.timeout(20000),
    })
    const body = await upstream.text()
    // A 5xx FROM UPSTREAM IS NOT A PAGE (2026-11-11: every wall sat on a bare
    // "503 Service Unavailable" with no way back). Passing it through parked
    // the panels on it — the Sharp browser never retries on its own. Treat it
    // like a failed request: the notice carries a 15s meta refresh, so the
    // wall recovers by itself once upstream answers again.
    if (upstream.status >= 500) {
      console.error(`[${new Date().toISOString()}] ${room}: upstream ${upstream.status}`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(notice('Reconnecting&hellip;'))
    }
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
