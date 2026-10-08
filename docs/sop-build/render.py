#!/usr/bin/env python3
"""render.py <fragment.html> <out.png> [dark|light] [stage-width=1000] [state] [viewport-width]
Wraps a screen fragment in the SOP harness and screenshots it (full page)."""
import asyncio, sys, os, re
from playwright.async_api import async_playwright
frag, out = sys.argv[1], sys.argv[2]
theme = sys.argv[3] if len(sys.argv) > 3 else 'dark'
width = sys.argv[4] if len(sys.argv) > 4 else '1000'
state = sys.argv[5] if len(sys.argv) > 5 else ''
vw = int(sys.argv[6]) if len(sys.argv) > 6 else max(int(width) + 80, 420)
here = os.path.dirname(os.path.abspath(__file__))
head = open(os.path.join(here, 'harness_head.html')).read().replace('__THEME__', theme).replace('__WIDTH__', width)
body = open(frag).read()
page = head + body + '</div></body></html>'
tmp = os.path.join(here, 'shots', '_tmp_%s.html' % os.getpid())
open(tmp, 'w').write(page)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': vw, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + tmp)
        if state:
            await pg.evaluate("s => document.querySelectorAll('.scr').forEach(e => e.setAttribute('data-state', s))", state)
        await pg.wait_for_timeout(300)
        info = await pg.evaluate("({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, keys: Array.from(new Set(Array.from(document.querySelectorAll('[data-k]')).flatMap(e => e.getAttribute('data-k').split(' ')))), scripts: document.querySelectorAll('.stage script').length})")
        await pg.screenshot(path=out, full_page=True)
        print('overflow-x:', info['sw'] > info['cw'], '| keys:', ', '.join(info['keys']), '| scripts:', info['scripts'], '| errors:', errs)
        await b.close()
asyncio.run(main())
os.remove(tmp)
