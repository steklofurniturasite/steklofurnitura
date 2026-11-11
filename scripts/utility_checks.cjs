/* Focused regression coverage for the five catalogue conveniences. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],hasTouch:true,viewport:{width:375,height:850}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=(process.env.TEST_ORIGIN||'http://127.0.0.1:8000')+'/steklofurnitura';
  const products=JSON.parse(fs.readFileSync('dist/products.json'));
  const target=products.find(p=>p.article==='SR-670 32x325x500 SSS');
  await page.goto(base+target.url);
  await page.locator('[data-copy-article]').click();
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('Артикул скопирован'));
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),target.article);assert.equal(await page.locator('[data-copy-article]').innerText(),'Скопировано ✓');
  await page.evaluate(()=>{navigator.clipboard.writeText=()=>Promise.reject(new Error('denied'));});
  await page.locator('[data-copy-article]').click();
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('Не удалось скопировать'));
  assert.equal(await page.locator('[data-copy-article]').isEnabled(),true);assert.equal(await page.locator('[data-copy-article]').innerText(),'Повторить');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('.product-main-image').click();
  const swipe=async(dx,dy)=>page.locator('.lightbox img').evaluate((el,{dx,dy})=>{
   const touch=(x,y)=>new Touch({identifier:1,target:el,clientX:x,clientY:y});
   el.dispatchEvent(new TouchEvent('touchstart',{touches:[touch(220,220)],bubbles:true}));
   el.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[touch(220+dx,220+dy)],bubbles:true}));
  },{dx,dy});
  await swipe(-130,5);await page.waitForFunction(()=>document.querySelector('.lightbox-count').textContent.startsWith('2 /'));
  await swipe(2,130);assert((await page.locator('.lightbox-count').innerText()).startsWith('2 /'));
  await swipe(130,5);await page.waitForFunction(()=>document.querySelector('.lightbox-count').textContent.startsWith('1 /'));
  await page.keyboard.press('Escape');
  const category=target.url.slice(0,target.url.lastIndexOf('/')+1);
  await page.goto(base+category);await page.selectOption('#sort-products','article');await page.reload();
  assert.equal(await page.locator('#sort-products').inputValue(),'article');
  await page.waitForFunction(()=>document.querySelector('.catalog-products').getAttribute('aria-busy')!=='true');
  const articles=await page.locator('.catalog-products .product-article').allTextContents();
  assert.deepEqual(articles,[...articles].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true})));
  await page.selectOption('#sort-products','default');await page.reload();assert.equal(await page.locator('#sort-products').inputValue(),'default');
  // A deliberately ambiguous fixture verifies ranking, independently of catalogue order.
  await page.route('**/products.json',route=>route.fulfill({json:[{...target,article:'OTHER',name:target.article+' совместимая деталь'},{...target}]}));
  await page.goto(base+'/search.html?q='+encodeURIComponent(target.article));
  await page.waitForFunction(()=>document.querySelectorAll('#search-results .product-card').length===2);
  assert.equal(await page.locator('#search-results .product-article').first().innerText(),target.article);
  await page.unroute('**/products.json');
  await page.goto(base+target.url);await page.locator('.order-actions [data-product]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('steklofurnitura-inquiry')||'[]').length===1);
  await page.goto(base+'/system/cart.html');await page.locator('.cart-row').waitFor();
  await page.evaluate(()=>{window.print=()=>{window.printRequested=true;};});await page.locator('#print-inquiry').click();assert(await page.evaluate(()=>window.printRequested));
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('#print-inquiry').isVisible(),false);assert.equal(await page.locator('.cart-remove').isVisible(),false);assert.equal(await page.locator('.cart-row').isVisible(),true);
  assert((await page.locator('.cart-total').innerText()).includes('Цену уточняйте'));
  await page.pdf({path:process.env.INQUIRY_PDF||'/tmp/steklofurnitura-inquiry.pdf',format:'A4'});
  assert.deepEqual(errors,[]);
  console.log('PASS: article copy and failure; horizontal swipe and vertical guard; remembered sorting/reset; exact article ranking; print and PDF');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
