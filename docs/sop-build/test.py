import asyncio, sys, json
from playwright.async_api import async_playwright
W = int(sys.argv[1]) if len(sys.argv)>1 else 1320
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':W,'height':900})
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' and 'fonts.g' not in m.text and 'ERR_' not in m.text else None)
        await pg.goto('file://'+__import__('os').path.abspath('billing-sop.html'))
        await pg.wait_for_timeout(400)
        chs = await pg.evaluate("Array.from(document.querySelectorAll('.sop-ch')).map(e=>e.getAttribute('data-s'))")
        bad=[]
        for c in chs:
            await pg.evaluate("id=>go(id)", c)
            await pg.wait_for_timeout(120)
            ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if ov>1: bad.append(('page-overflow',c,ov))
            walks = await pg.evaluate("id=>Array.from(document.querySelectorAll('#s-'+id+' .sop-walk')).map(e=>e.getAttribute('data-walk'))", c)
            for w in walks:
                n = await pg.evaluate("w=>WALKS[w].steps.length", w)
                for i in range(n):
                    if i>0:
                        await pg.click(f'.sop-walk[data-walk="{w}"] .sop-wnext')
                    await pg.wait_for_timeout(60 if i else 30)
                    info = await pg.evaluate("""([w,i])=>{const el=document.querySelector('.sop-walk[data-walk="'+w+'"]');const s=WALKS[w].steps[i];
                      const rings=el.querySelectorAll('.sop-spot .sop-ring').length; const k=el.querySelector('.sop-wk').textContent;
                      const st=el.querySelector('.scr').getAttribute('data-state')||'';
                      // is first ring within viewport below panel?
                      let vis=null; const r=el.querySelector('.sop-spot .sop-ring'); if(r){const b=r.getBoundingClientRect(); const pb=el.querySelector('.sop-wpanel').getBoundingClientRect(); vis=[Math.round(b.top-pb.bottom), Math.round(b.bottom), innerHeight, Math.round(b.left), Math.round(b.right), innerWidth];}
                      return {k, rings, keys:s.k, st, want:s.s||'', vis}}""", [w,i])
                    await pg.wait_for_timeout(1100)
                    info2 = await pg.evaluate("""([w])=>{const el=document.querySelector('.sop-walk[data-walk="'+w+'"]');const r=el.querySelector('.sop-spot .sop-ring'); if(!r) return null; const b=r.getBoundingClientRect(); const pb=el.querySelector('.sop-wpanel').getBoundingClientRect(); return [Math.round(b.top-pb.bottom), Math.round(b.bottom), innerHeight, Math.round(b.left), Math.round(b.right), innerWidth, el.querySelectorAll('.sop-spot .sop-ring').length]}""", [w])
                    if info['keys'] and (not info2 or info2[6]==0): bad.append(('no-ring', w, i, info['keys'], info['st']))
                    elif info2 and (info2[0] < 0 or info2[3] < 0 or info2[4] > info2[5]+1 or info2[0] > info2[2]): bad.append(('offscreen', w, i, info['keys'], info2))
                    if info['st'] != info['want']: bad.append(('state', w, i, info['st'], info['want']))
        print('errors:', errs)
        print('problems:', len(bad))
        for x in bad: print('  ', x)
        await b.close()
asyncio.run(main())
