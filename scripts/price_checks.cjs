/* Real catalogue agreement plus controlled numeric/unknown cart scenarios. */
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});try{
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=(process.env.TEST_ORIGIN||'http://127.0.0.1:8000')+'/steklofurnitura';
 await page.goto(base+'/');const products=await page.evaluate(async()=>await(await fetch('./products.json')).json());assert.equal(products.length,1463);
 for(const p of products){if(p.priceStatus==='verified'){assert(Number.isSafeInteger(p.priceAmountMinor)&&p.priceAmountMinor>0);assert(p.price.endsWith(' BYN'));}else{assert.equal(p.price,'Цену уточняйте');assert.equal(p.priceAmountMinor,null);}}
 const sample=products.slice(0,3).map(p=>({...p}));Object.assign(sample[0],{price:'12,34 BYN',priceAmountMinor:1234,priceStatus:'verified'});Object.assign(sample[1],{price:'0,10 BYN',priceAmountMinor:10,priceStatus:'verified'});Object.assign(sample[2],{price:'Цену уточняйте',priceAmountMinor:null,priceStatus:'request'});
 await page.route('**/products.json',r=>r.fulfill({json:sample}));
 async function cart(items){await page.evaluate(items=>localStorage.setItem('steklofurnitura-inquiry',JSON.stringify(items)),items);await page.goto(base+'/system/cart.html');await page.locator('.cart-row').first().waitFor();}
 await cart([{url:sample[0].url,qty:3},{url:sample[1].url,qty:7}]);assert.equal((await page.locator('.cart-total').innerText()).trim(),'Итого: 37,72 BYN (с НДС)');assert((await page.locator('.cart-price').first().innerText()).includes('37,02 BYN'));
 await page.locator('.cart-row').first().locator('[data-qty="1"]').click();await page.waitForFunction(()=>document.querySelector('.cart-total')?.textContent.includes('50,06 BYN'));
 await page.reload();await page.locator('.cart-row').first().waitFor();assert((await page.locator('.cart-total').innerText()).includes('50,06 BYN'));
 await page.locator('#copy-inquiry').click();let copied=await page.evaluate(()=>navigator.clipboard.readText());assert(copied.includes('Цена: 12,34 BYN (с НДС)'));assert(copied.includes('Итого: 50,06 BYN (с НДС)'));
 await page.locator('.cart-row input').first().fill('5');await page.locator('.cart-row input').first().blur();await page.waitForFunction(()=>document.querySelector('.cart-total')?.textContent.includes('62,40 BYN'));
 await cart([{url:sample[0].url,qty:2},{url:sample[2].url,qty:1}]);assert((await page.locator('.cart-total').innerText()).startsWith('Итого: Цену уточняйте'));assert((await page.locator('.cart-total').innerText()).includes('24,68 BYN'));assert.equal((await page.locator('.cart-price').last().innerText()).trim(),'Цену уточняйте');
 await page.locator('.cart-remove').last().click();await page.waitForFunction(()=>document.querySelector('.cart-total')?.textContent==='Итого: 24,68 BYN (с НДС)');
 await cart([{url:sample[2].url,qty:1}]);assert.equal((await page.locator('.cart-total').innerText()).trim(),'Итого: Цену уточняйте');
 // Legacy stored cart payloads cannot supply a stale price; lookup always uses current products.json.
 await cart([{url:sample[2].url,qty:1,price:'1,00 BYN',priceAmountMinor:100}]);assert.equal((await page.locator('.cart-total').innerText()).trim(),'Итого: Цену уточняйте');
 assert.deepEqual(errors,[]);console.log('PASS: complete price metadata, exact kopeck totals, quantity/persistence, copied enquiry, mixed/unknown prices and stale storage');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
