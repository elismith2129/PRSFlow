# Steps every step of a built guide in a headless browser and fails on a miss.
#   python3 test.py                       → billing-sop.html at 1320 wide
#   python3 test.py runner-sop.html 390   → the runner guide on a phone
#   python3 test.py runner-sop.html 375 560 → …on a short phone
# A miss is: a step that names keys but lights nothing · a lit part that ends up
# off-screen or under the step panel · a screen left in the wrong state · a page
# that scrolls sideways.
import asyncio, sys, os
from playwright.async_api import async_playwright
FILE, W = 'billing-sop.html', 1320
nums = [int(a) for a in sys.argv[1:] if a.isdigit()]
for a in sys.argv[1:]:
    if not a.isdigit(): FILE = a
if nums: W = nums[0]
H = nums[1] if len(nums) > 1 else (900 if W > 600 else 700)   # optional: a window height
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': W, 'height': H})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_' not in m.text else None)
        await pg.goto('file://' + os.path.abspath(FILE))
        await pg.wait_for_timeout(400)
        chs = await pg.evaluate("Array.from(document.querySelectorAll('.sop-ch')).map(e=>e.getAttribute('data-s'))")
        bad, tall = [], 0
        for c in chs:
            await pg.evaluate("id=>go(id)", c)
            await pg.wait_for_timeout(120)
            ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if ov > 1: bad.append(('page-overflow', c, ov))
            walks = await pg.evaluate("id=>Array.from(document.querySelectorAll('#s-'+id+' .sop-walk')).map(e=>e.getAttribute('data-walk'))", c)
            for w in walks:
                n = await pg.evaluate("w=>WALKS[w].steps.length", w)
                for i in range(n):
                    if i > 0:
                        await pg.click(f'.sop-walk[data-walk="{w}"] .sop-wnext')
                    else:
                        # a walk further down the chapter: bring it up the way a reader scrolling would
                        await pg.evaluate("w=>{const el=document.querySelector('.sop-walk[data-walk=\"'+w+'\"]'); window.scrollTo(0, el.getBoundingClientRect().top + pageYOffset - 60)}", w)
                    await pg.wait_for_timeout(1150)
                    r = await pg.evaluate("""([w,i])=>{
                      const el=document.querySelector('.sop-walk[data-walk="'+w+'"]'), s=WALKS[w].steps[i];
                      const panel=el.querySelector('.sop-wpanel'), stage=el.querySelector('.sop-stage');
                      const pb=panel.getBoundingClientRect(), sb=stage.getBoundingClientRect();
                      const where = (pb.left>=sb.right-2||pb.right<=sb.left+2) ? 'side' : (getComputedStyle(panel).order==='2' ? 'bottom' : 'top');
                      let top=0; for (const sel of ['.sop-bar','.sop-rail']) { const e=document.querySelector(sel); if(!e) continue; const cs=getComputedStyle(e), r=e.getBoundingClientRect(); if(cs.display!=='none'&&cs.position==='sticky'&&r.height<120) top=Math.max(top,(parseFloat(cs.top)||0)+r.height); }
                      const rings=[...el.querySelectorAll('.sop-spot .sop-ring')].map(x=>x.getBoundingClientRect());
                      const lo = where==='top' ? pb.bottom : top, hi = where==='bottom' ? pb.top : innerHeight;
                      const f=rings[0];
                      return {where, n:rings.length, keys:s.k, st:el.querySelector('.scr').getAttribute('data-state')||'', want:s.s||'',
                              ring:f?[Math.round(f.top),Math.round(f.bottom),Math.round(f.left),Math.round(f.right)]:null, lo:Math.round(lo), hi:Math.round(hi), vw:innerWidth,
                              panelH:Math.round(pb.height), panelOn: pb.top>=0 && pb.bottom<=innerHeight+1}}""", [w, i])
                    tall = max(tall, r['panelH'])
                    if r['keys'] and r['n'] == 0: bad.append(('no-ring', w, i, r['keys'], r['st']))
                    elif r['ring']:
                        t, bt, l, rt = r['ring']
                        # the top of the lit part must be in the clear; so must its sides
                        # (the first step of a desk walk is not scrolled to: only its sides are checked)
                        if ((i > 0 or r['where'] == 'bottom') and (t < r['lo'] - 2 or t > r['hi'] - 24)) or l < -1 or rt > r['vw'] + 1: bad.append(('offscreen', w, i, r['keys'], r['ring'], r['lo'], r['hi']))
                    if r['st'] != r['want']: bad.append(('state', w, i, r['st'], r['want']))
                    if not r['panelOn'] and (i > 0 or r['where'] == 'bottom'): bad.append(('panel-off-screen', w, i))
        print(FILE, '@', W, '· errors:', errs)
        print('tallest step panel:', tall, 'px of', H)
        print('problems:', len(bad))
        for x in bad: print('  ', x)
        await b.close()
asyncio.run(main())
