/* Run against a prepared site served with its deployment base path. */
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('assert/strict');
(async () => {
 const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:8000';
 const base = process.env.TEST_BASE === undefined ? '/steklofurnitura' : process.env.TEST_BASE;
 const source=JSON.parse(fs.readFileSync('dist/products.json'));
 const target=source.find(p=>p.article==='SR-670 32x325x500 SSS');assert(target);
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function visit(path){await page.goto(origin+base+path);}
 let requests=0;
 await page.route('**/products.json',async route=>{requests++;if(requests===1)await route.fulfill({status:503,body:'temporary'});else await route.continue();});
 await visit('/search.html?q='+encodeURIComponent(target.article));
 await page.locator('[data-retry="search"]').waitFor();assert.equal(requests,1);
 await page.locator('[data-retry="search"]').click();await page.locator('.product-card').first().waitFor();assert.equal(requests,2);
 assert((await page.locator('#search-results').innerText()).includes(target.article));
 await page.unroute('**/products.json');
 for(const query of ['ручка','zzzzNONEXISTENT777']){
  await visit('/search.html?q='+encodeURIComponent(query));await page.waitForFunction(()=>document.querySelector('#search-results').getAttribute('aria-busy')==='false');
  assert(query==='ручка' ? await page.locator('.product-card').count()>0 : (await page.locator('#search-results').innerText()).includes('Ничего не найдено'));
 }
 const sample=[target,source.find(p=>p.url.startsWith('/catalog/dvernye-dovodchiki/')),source.find(p=>p.url.startsWith('/catalog/alyuminievye-profili/'))];assert(sample.every(Boolean));
 for(const [index,product] of sample.entries()){await visit(product.url);await page.locator('.order-actions [data-product]').click();await page.waitForFunction(count=>JSON.parse(localStorage.getItem('steklofurnitura-inquiry')||'[]').length===count,index+1);}
 await visit('/system/cart.html');await page.locator('.cart-row').first().waitFor();assert.equal(await page.locator('.cart-row').count(),3);
 await page.locator('.cart-row').first().locator('[data-qty="1"]').click();assert.equal(await page.locator('.cart-row input').first().inputValue(),'2');
 await page.reload();await page.locator('.cart-row').first().waitFor();assert.equal(await page.locator('.cart-row input').first().inputValue(),'2');
 await page.locator('#copy-inquiry').click();const text=await page.evaluate(()=>navigator.clipboard.readText());
 const urls=text.match(/https?:\/\/\S+/g);assert.equal(urls.length,3);for(const url of urls){assert(url.startsWith(origin+base+'/catalog/'));assert.equal((await context.request.get(url)).status(),200);assert(!url.includes(base+base+'/'));}
 await page.locator('.cart-remove').last().click();await page.waitForFunction(()=>document.querySelectorAll('.cart-row').length===2);
 // Inspect representative layouts at desktop and mobile sizes, without visiting every product.
 const screenshots=process.env.SCREENSHOT_DIR || '/tmp/steklofurnitura-screenshots';
 fs.mkdirSync(screenshots,{recursive:true});
 for(const width of [1440,375]){
  await page.setViewportSize({width,height:950});
  for(const [name,path] of [['home','/'],['catalog','/catalog.html'],['category','/catalog/dvernye-dovodchiki/'],['product',target.url],['search','/search.html?q=SR-670'],['cart','/system/cart.html']]){
   await visit(path);await page.waitForTimeout(150);if(name==='search'||name==='cart')await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
   assert(await page.locator('main h1').count()===1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+name+' '+width);
   if(name==='product'||name==='category'||name==='search'){
    for(const value of await page.locator('.product-stock').allTextContents())assert.equal(value.trim(),'Наличие уточняется');
    assert.equal(await page.locator('.sale-label').count(),0);
   }
   assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth===0).length),0);
   await page.screenshot({path:`${screenshots}/${name}-${width}.png`,fullPage:true});
  }
 }
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: network recovery, searches, 3 enquiry URLs, cart CRUD/persistence, 12 layouts, images, no JS errors');
})().catch(e=>{console.error(e);process.exit(1)});
