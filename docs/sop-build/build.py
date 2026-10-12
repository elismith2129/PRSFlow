#!/usr/bin/env python3
# Assembles a walkthrough SOP: shell + drawn screens + step copy.
#
#   python3 build.py                  → the Billing SOP  (content.py,        screens/)
#   python3 build.py runner           → the Runner guide (content_runner.py, runner/screens/)
#   python3 build.py runner out.html  → same, written somewhere else
#
# A guide is one content module. It holds CHAPTERS and, optionally, META — the
# title, where its drawn screens live, and its layout ('desk' = wide screens
# with the step panel on top; 'phone' = phone screens, step panel beside the
# drawing on a computer and pinned to the bottom of a phone, Next under the thumb).
import re, os, json, sys, html
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib
args = sys.argv[1:]
if args and args[0].endswith('.html'):      # old form: build.py out.html
    args = ['billing'] + args
NAME = args[0] if args else 'billing'
content = importlib.import_module('content' if NAME == 'billing' else 'content_' + NAME)
CH = content.CHAPTERS
META = dict(title='Billing SOP', bar='Billing SOP',
            barsub=' · Paramount Recording Studios · as of Oct 8, 2026',
            railsub='Billing Coordinator · Operating Manual',
            railfoot='What changed in each release: Training → App guide (SOP) → Version History.',
            screens='screens', mode='desk', headnote='headnote.txt', out='billing-sop.html')
META.update(getattr(content, 'META', {}))
SCR = os.path.join(HERE, META['screens'])
PHONE = META['mode'] == 'phone'
OUT = args[1] if len(args) > 1 else os.path.join(HERE, META['out'])

def step(s):
    """A step is (keys, title, body[, state]) or a dict with k/h/b and optional w (why) and s (state)."""
    if isinstance(s, dict):
        return dict(k=s['k'], h=s['h'], b=s['b'], w=s.get('w', ''), s=s.get('s', ''))
    return dict(k=s[0], h=s[1], b=s[2], w='', s=(s[3] if len(s) > 3 else ''))
for c in CH:
    for b in c['blocks']:
        if b['kind'] == 'walk':
            b['steps'] = [step(s) for s in b['steps']]

# ── drawn screens ────────────────────────────────────────────────────────────
used = []
for c in CH:
    for b in c['blocks']:
        if b['kind'] == 'walk' and b['scr'] not in used:
            used.append(b['scr'])
scr_css, scr_tpl = [], []
for name in used:
    s = open(os.path.join(SCR, name + '.html'), encoding='utf-8').read()
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
        src = open(os.path.join(SCR, b['scr'] + '.html'), encoding='utf-8').read()
        have = set(k for m in re.findall(r'data-k="([^"]+)"', src) for k in m.split())
        states = set(re.findall(r'data-state[~|^$*]?="([^"]+)"', src))
        for st in b['steps']:
            if st['s']:
                assert st['s'] in states, 'walk %s: state %s is not styled on screen %s' % (b['id'], st['s'], b['scr'])
            for k in st['k'].split():
                assert k in have, 'walk %s: key %s is not on screen %s' % (b['id'], k, b['scr'])

# ── chapters ─────────────────────────────────────────────────────────────────
walks = {}
def render_block(b):
    k = b['kind']
    if k == 'walk':
        walks[b['id']] = dict(scr=b['scr'], steps=[dict((k, v) for k, v in s.items() if v or k in 'khb') for s in b['steps']])
        if PHONE:
            return ('<section class="sop-walk" data-walk="%s">\n'
                    '  <h2 class="sop-wtitle">%s</h2>\n'
                    '  <div class="sop-wpanel" role="group" aria-label="Walkthrough steps">\n'
                    '    <div class="sop-wtop"><span class="sop-wk"></span><span class="sop-wbar"><i></i></span></div>\n'
                    '    <div class="sop-wh" aria-live="polite"></div>\n'
                    '    <div class="sop-wb"></div>\n'
                    '    <div class="sop-ww"><b class="sop-wwk">Why</b><span class="sop-wwt"></span></div>\n'
                    '    <div class="sop-wnav"><button class="sop-wbtn sop-wprev" type="button">← Back</button><button class="sop-wbtn sop-wnext" type="button">Next →</button></div>\n'
                    '  </div>\n'
                    '  <div class="sop-stage" data-scr="%s"><div class="sop-stagein"></div></div>\n'
                    '</section>') % (b['id'], b['title'], b['scr'])
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
HEAD_NOTE = open(os.path.join(HERE, META['headnote']), encoding='utf-8').read()

page = '''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PRSFlo — %s</title>
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
<body%s>
<div class="sop-bar">
  <span class="sop-bartitle"><b>%s</b><span class="sop-barsub">%s</span></span>
  <span class="sop-grow"></span>
  <button class="sop-ctl" type="button" id="themeBtn">View light</button>
</div>
<div class="sop-frame">
<nav class="sop-rail" aria-label="Chapters">
  <span class="sop-wm">PRS<span class="sop-flo">Flo</span></span>
  <span class="sop-sub">%s</span>
  %s
  <div class="sop-railfoot">%s</div>
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
''' % (META['title'], HEAD_NOTE.strip(), SHELL_CSS, '\n\n'.join(scr_css), ' class="sop-phone"' if PHONE else '', META['bar'], META['barsub'], META['railsub'], '\n  '.join(nav), META['railfoot'], '\n\n'.join(secs), '\n'.join(scr_tpl),
       json.dumps(walks, ensure_ascii=False, separators=(',', ':')), ENGINE_JS)
open(OUT, 'w', encoding='utf-8').write(page)
nsteps = sum(len(w['steps']) for w in walks.values())
print('wrote', OUT, len(page), 'bytes ·', len(CH), 'chapters ·', len(walks), 'walks ·', nsteps, 'steps ·', len(used), 'screens')
