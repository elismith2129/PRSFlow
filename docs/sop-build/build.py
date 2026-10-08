#!/usr/bin/env python3
# Assembles the walkthrough Billing SOP: shell + drawn screens + step copy.
import re, os, json, sys, html
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib, content
importlib.reload(content)
CH = content.CHAPTERS
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'billing-sop.html')

# ── drawn screens ────────────────────────────────────────────────────────────
used = []
for c in CH:
    for b in c['blocks']:
        if b['kind'] == 'walk' and b['scr'] not in used:
            used.append(b['scr'])
scr_css, scr_tpl = [], []
for name in used:
    s = open(os.path.join(HERE, 'screens', name + '.html'), encoding='utf-8').read()
    styles = re.findall(r'<style[^>]*>(.*?)</style>', s, flags=re.S)
    body = re.sub(r'<style[^>]*>.*?</style>', '', s, flags=re.S).strip()
    assert '<script' not in body, name
    assert 'class="scr scr-' + name in body, name
    scr_css.append('/* ── screen: %s ── */\n%s' % (name, '\n'.join(x.strip() for x in styles)))
    scr_tpl.append('<template id="tpl-%s">\n%s\n</template>' % (name, body))

# every key a step names must exist on its screen
for c in CH:
    for b in c['blocks']:
        if b['kind'] != 'walk':
            continue
        src = open(os.path.join(HERE, 'screens', b['scr'] + '.html'), encoding='utf-8').read()
        have = set(k for m in re.findall(r'data-k="([^"]+)"', src) for k in m.split())
        for st in b['steps']:
            for k in st[0].split():
                assert k in have, 'walk %s: key %s is not on screen %s' % (b['id'], k, b['scr'])

# ── chapters ─────────────────────────────────────────────────────────────────
walks = {}
def render_block(b):
    k = b['kind']
    if k == 'walk':
        walks[b['id']] = dict(scr=b['scr'], steps=[dict(k=s[0], h=s[1], b=s[2], s=(s[3] if len(s) > 3 else '')) for s in b['steps']])
        return ('<section class="sop-walk" data-walk="%s">\n'
                '  <h2 class="sop-wtitle">%s</h2>\n'
                '  <div class="sop-wpanel" role="group" aria-label="Walkthrough steps">\n'
                '    <div class="sop-wtop"><span class="sop-wk"></span><span class="sop-wbar"><i></i></span>'
                '<button class="sop-wbtn sop-wprev" type="button">← Back</button><button class="sop-wbtn sop-wnext" type="button">Next →</button></div>\n'
                '    <div class="sop-wh" aria-live="polite"></div>\n'
                '    <div class="sop-wb"></div>\n'
                '  </div>\n'
                '  <div class="sop-stage" data-scr="%s"><div class="sop-stagein"></div></div>\n'
                '</section>') % (b['id'], b['title'], b['scr'])
    if k == 'pane':
        return '<div class="sop-pane"><h3>%s</h3>%s</div>' % (b['title'], b['html'])
    if k == 'rhythm':
        rows = ''.join('<div class="sop-rrow"><div class="sop-rwhen">%s</div><ul>%s</ul></div>' % (w, ''.join('<li>%s</li>' % x for x in items)) for w, items in b['rows'])
        return '<div class="sop-pane sop-rhythm">%s</div>' % rows
    if k in ('help', 'words'):
        rows = ''.join('<div class="sop-drow"><b>%s</b><span>%s</span></div>' % (a, t) for a, t in b['rows'])
        return '<div class="sop-pane sop-%s"><h3>%s</h3>%s</div>' % (k, b['title'], rows)
    raise SystemExit('unknown block ' + k)

nav, secs, last_group = [], [], object()
for i, c in enumerate(CH):
    if c['group'] != last_group and c['group']:
        nav.append('<div class="sop-grp">%s</div>' % c['group'])
    last_group = c['group']
    nav.append('<button class="sop-ch%s" data-s="%s" type="button"><span class="sop-n">%s</span>%s</button>' % (' on' if i == 0 else '', c['id'], c['n'], c['nav']))
    prev = CH[i - 1] if i > 0 else None
    nxt = CH[i + 1] if i + 1 < len(CH) else None
    foot = '<div class="sop-cfoot">%s%s</div>' % (
        '<button class="sop-cnav" type="button" data-go="%s">← %s</button>' % (prev['id'], prev['nav']) if prev else '<span></span>',
        '<button class="sop-cnav sop-cnext" type="button" data-go="%s">Next · %s →</button>' % (nxt['id'], nxt['nav']) if nxt else '<span></span>')
    secs.append('<section class="sop-section%s" id="s-%s">\n<header class="sop-hbar"><div class="sop-kicker">Chapter %s</div><h1>%s</h1>%s</header>\n%s\n%s\n</section>' % (
        ' on' if i == 0 else '', c['id'], c['n'], c['h1'],
        '<p class="sop-lede">%s</p>' % c['lede'] if c['lede'] else '',
        '\n'.join(render_block(b) for b in c['blocks']), foot))

SHELL_CSS = open(os.path.join(HERE, 'shell.css'), encoding='utf-8').read()
ENGINE_JS = open(os.path.join(HERE, 'engine.js'), encoding='utf-8').read()
HEAD_NOTE = open(os.path.join(HERE, 'headnote.txt'), encoding='utf-8').read()

page = '''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRSFlo — Billing SOP</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bebas+Neue&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<!--
%s
-->
<style>
%s
</style>
<style>
%s
</style>
</head>
<body>
<div class="sop-bar">
  <span class="sop-bartitle"><b>Billing SOP</b><span class="sop-barsub"> · Paramount Recording Studios · as of Oct 7, 2026</span></span>
  <span class="sop-grow"></span>
  <button class="sop-ctl" type="button" id="themeBtn">View light</button>
</div>
<div class="sop-frame">
<nav class="sop-rail" aria-label="Chapters">
  <span class="sop-wm">PRS<span class="sop-flo">Flo</span></span>
  <span class="sop-sub">Billing Coordinator · Operating Manual</span>
  %s
  <div class="sop-railfoot">What changed in each release: Training → App guide (SOP) → Version History.</div>
</nav>
<main class="sop-main">
%s
</main>
</div>
%s
<script>
var WALKS = %s;
%s
</script>
</body>
</html>
''' % (HEAD_NOTE.strip(), SHELL_CSS, '\n\n'.join(scr_css), '\n  '.join(nav), '\n\n'.join(secs), '\n'.join(scr_tpl),
       json.dumps(walks, ensure_ascii=False, separators=(',', ':')), ENGINE_JS)
open(OUT, 'w', encoding='utf-8').write(page)
nsteps = sum(len(w['steps']) for w in walks.values())
print('wrote', OUT, len(page), 'bytes ·', len(CH), 'chapters ·', len(walks), 'walks ·', nsteps, 'steps ·', len(used), 'screens')
