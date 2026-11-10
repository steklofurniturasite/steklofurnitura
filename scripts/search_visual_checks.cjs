const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});let checks=0;try{
 const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true}),p=await c.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));await c.addInitScript(()=>{window.searchAnimations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const a=animate.call(this,frames,options);window.searchAnimations.push({classes:this.className,frames});return a;};});
 const base=(process.env.TEST_ORIGIN||'http://127.0.0.1:8000')+'/steklofurnitura',check=(x,m)=>{assert(x,m);checks++;};
 const idle=()=>p.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false');
 fs.mkdirSync('/tmp/search-polish',{recursive:true});await p.goto(base+'/');const input=p.locator('form.search input');const before=await p.locator('form.search').boundingBox();
 await input.fill('SP1009');await p.locator('.search-suggestions [role="option"]').first().waitFor();
 const after=await p.locator('form.search').boundingBox();check(before.width===after.width&&before.height===after.height,'form geometry stable');
 check(await p.evaluate(()=>searchAnimations.some(a=>a.classes==='search-suggestions')),'suggestions entrance');
 const article=p.locator('.search-suggestions strong').first();check(await article.locator('mark').innerText()==='SP-1009','only matching article prefix');check((await article.innerText()).includes('AL+SSS'),'article suffix preserved');
 await p.locator('.search-suggestions').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));await p.screenshot({path:'/tmp/search-polish/suggestions-390.png'});
 await input.press('Escape');check(await input.getAttribute('aria-expanded')==='false','closed immediately for AT');
 check(await p.locator('.search-suggestions-exit').evaluateAll(els=>els.every(e=>e.inert&&e.getAttribute('aria-hidden')==='true'&&!e.id)),'exit inert and no duplicate ID');
 await p.waitForFunction(()=>!document.querySelector('.search-suggestions-exit'));checks++;
 await input.fill('SP1009');await p.locator('.search-suggestions [role="option"]').first().waitFor();await input.fill('HAG');await p.locator('.search-suggestions strong').filter({hasText:'HAG'}).first().waitFor();
 check(await p.locator('.search-suggestions').count()===1,'one real panel after rapid input');
 await p.emulateMedia({reducedMotion:'reduce'});await input.press('Escape');check(await p.locator('.search-suggestions-exit').count()===0,'reduced motion closes instantly');
 await p.goto(base+'/search.html?q='+encodeURIComponent('SP1009 SSS'));await idle();const multi=p.locator('#search-results .product-article').filter({hasText:'SP-1009 AL+SSS'}).first();check(await multi.locator('mark').count()===2,'multiple article fragments');check((await multi.locator('mark').allTextContents()).join('|')==='SP-1009|SSS','separator-safe fragments');
 for(const [q,expected] of [['SP—1009','SP-1009'],['SR67032x325','SR-670 32x325']]){await p.goto(base+'/search.html?q='+encodeURIComponent(q));await idle();check(await p.locator('#search-results .product-article mark').first().innerText()===expected,'normalized partial highlight '+q);}
 await p.goto(base+'/search.html?q=душевой');await idle();await p.screenshot({path:'/tmp/search-polish/results-390.png'});
 const first=p.locator('#search-results .product-card').first();await first.evaluate(e=>e.dataset.retained='yes');await p.locator('#search-more').click();check(await first.getAttribute('data-retained')==='yes','show more retains existing nodes');
 const select=p.locator('[data-search-filter]').first();await select.selectOption(await select.locator('option').nth(1).getAttribute('value'));check(await select.evaluate(e=>e.closest('label').classList.contains('is-applied')),'visible active filter');await select.selectOption('');check(await select.evaluate(e=>!e.closest('label').classList.contains('is-applied')),'reset filter state');
 for(const width of [360,390,480,768,1440]){await p.setViewportSize({width,height:900});check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:'/tmp/search-polish/results-1440.png'});
 await p.goto(base+'/search.html?q=zzzzNORESULT');await idle();check(await p.locator('.empty-state h2').innerText()==='Ничего не найдено','empty state');
 await p.goto(base+'/');await input.fill('SP1009');await p.locator('.logo').click();await p.waitForTimeout(240);check(await p.locator('.search-suggestions:not([hidden])').count()===0,'no delayed reopening after focus loss');
 let release;const gate=new Promise(resolve=>release=resolve);await p.route('**/products.json',async route=>{await gate;await route.continue();});
 await p.goto(base+'/search.html?q=SP1009');await p.locator('.search-loading').waitFor();check(await p.locator('#search-results').getAttribute('aria-busy')==='true','stable loading state');await p.locator('#search-query').fill('');await p.waitForFunction(()=>document.querySelector('#search-results').getAttribute('aria-busy')==='false');release();await p.waitForTimeout(250);check(await p.locator('#search-results .product-card').count()===0,'clearing pending results stays empty');
 assert.deepEqual(errors,[]);console.log(`PASS: ${checks} visual search checks; partial highlights, motion, races, reduced motion, filters, retained nodes, responsive layout`);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
