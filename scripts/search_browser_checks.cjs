const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});try{
 const context=await b.newContext({viewport:{width:360,height:850},hasTouch:true}),p=await context.newPage(),errors=[];let checks=0;
 p.on('pageerror',e=>errors.push(e.message));const base=(process.env.TEST_ORIGIN||'http://127.0.0.1:8000')+'/steklofurnitura';
 const check=(condition,message)=>{assert(condition,message);checks++;};
 const idle=()=>p.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false');
 let requests=0;await p.route('**/products.json',async r=>{requests++;await r.continue();});
 await p.goto(base+'/');const input=p.locator('form.search input');await input.fill('SP1009');
 await p.locator('.search-suggestions [role="option"]').first().waitFor();check(await input.getAttribute('aria-expanded')==='true','expanded');
 check(await p.locator('.search-suggestions [role="option"]').count()<=6,'bounded suggestions');
 await input.press('ArrowUp');check((await input.getAttribute('aria-activedescendant')).endsWith('-'+(await p.locator('.search-suggestions [role="option"]').count()-1)),'up selects last');await input.press('ArrowDown');check((await input.getAttribute('aria-activedescendant')).endsWith('-0'),'down wraps to first');
 await input.press('Escape');check(await input.getAttribute('aria-expanded')==='false','escape closes');
 await input.fill('Titan');await p.locator('.search-suggestions [role="option"]').first().waitFor();await p.locator('form.search .search-clear').click();
 check(await input.inputValue()==='','clear');check(await input.evaluate(e=>e===document.activeElement),'clear restores focus');
 await input.fill('ХАГ');await p.locator('.search-suggestions [role="option"]').first().waitFor();
 check(requests===1,'one catalogue request');check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile suggestion overflow');
 await p.locator('[data-toggle="mobile-nav"]').click();check(await input.getAttribute('aria-expanded')==='false','menu closes suggestions');await p.locator('[data-toggle="mobile-nav"]').click();
 await input.focus();await input.fill('SR-670 32x325x500 SSS');await p.locator('.search-suggestions [role="option"]').first().waitFor();await input.press('ArrowDown');const target=await p.locator('.search-suggestions [role="option"]').first().getAttribute('href');await input.press('Enter');await p.waitForURL(url=>url.pathname===target);checks++;
 await p.goto(base+'/search.html?q=душевой');await idle();check(await p.locator('#search-results .product-card').count()===30,'first page 30');
 check(await p.locator('#search-results mark').count()>0,'safe highlighting');
 await p.locator('#search-more').click();check(await p.locator('#search-results .product-card').count()===60,'second page 60');
 const filters=p.locator('[data-search-filter]');check(await filters.count()>0,'filters available');
 const filter=filters.first();const option=await filter.locator('option').nth(1).getAttribute('value');await filter.selectOption(option);check(await p.locator('#search-results .product-card').count()<=30,'filtered pagination reset');
 const query=p.locator('#search-query');await query.fill('SP1009');await p.waitForFunction(()=>document.querySelector('#search-summary').textContent.includes('SP1009'));await idle();check(await p.locator('#search-results .product-card').count()>0,'live results');
 await query.fill('zzzzzzNORESULT');await query.fill('SR670');await p.waitForFunction(()=>document.querySelector('#search-summary').textContent.includes('SR670'));check(await p.locator('#search-results .product-card').count()>0,'latest input wins');
 await p.locator('.large-search .search-clear').click();await p.waitForFunction(()=>document.querySelector('#search-results').children.length===0);checks++;
 for(const q of ['catalog','html','---','<img src=x onerror=alert(1)>']){await p.goto(base+'/search.html?q='+encodeURIComponent(q));await idle();check(await p.locator('#search-results .product-card').count()===0,'invalid/technical query '+q);check(await p.locator('#search-results img').count()===0,'no injection');}
 await p.goto(base+'/system/search.html?q=SP1009');await idle();check(await p.locator('#search-results .product-card').count()>0,'legacy search');
 for(const width of [360,375,720,1440]){await p.setViewportSize({width,height:850});check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'results overflow '+width);}
 await p.unroute('**/products.json');let attempts=0;await p.route('**/products.json',async r=>{attempts++;if(attempts===1)await r.fulfill({status:503,body:'temporary'});else await r.continue();});
 await p.goto(base+'/search.html?q=SP1009');await p.locator('[data-retry="search"]').click();await idle();check(await p.locator('#search-results .product-card').count()>0,'network recovery');check(attempts===2,'retry fetch count');
 assert.deepEqual(errors,[]);console.log(`PASS: ${checks} search browser checks; mobile/desktop, keyboard, pagination, filters, stale input, legacy URL, injection and retry`);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
