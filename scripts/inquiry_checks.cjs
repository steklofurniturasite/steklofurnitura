const{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});let checks=0;try{
const c=await b.newContext({viewport:{width:375,height:850},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true}),p=await c.newPage(),errors=[],requests=[];let behavior='success',release;
p.on('pageerror',e=>errors.push(e.message));
// Catch every FormSubmit request; no request can reach the service, including activation.
await c.route('https://formsubmit.co/**',async route=>{
 const r=route.request();assert.equal(r.method(),'POST');assert.equal(r.url(),'https://formsubmit.co/ajax/steklofurniturasite@gmail.com');requests.push(r.postDataJSON());
 if(behavior==='hold')await new Promise(resolve=>release=resolve);
 if(behavior==='network')return route.abort('failed');
 if(behavior==='timeout')return; // Playwright aborts this intercepted request when the real 15s controller fires.
 if(behavior==='invalid')return route.fulfill({contentType:'application/json',body:'not JSON'});
 const data=behavior==='activation'?{success:'false',message:'This form needs Activation...'}:behavior==='false'?{success:'false',message:'Not accepted'}:behavior==='boolean'?{success:true}:{success:'true'};
 await route.fulfill({status:behavior==='http'?500:200,json:data});
});
const check=(condition,message)=>{assert(condition,message);checks++;};const base=(process.env.TEST_ORIGIN||'http://127.0.0.1:8000')+'/steklofurnitura';
await p.goto(base+'/');const products=await p.evaluate(async()=>await(await fetch('./products.json')).json());
await p.evaluate(products=>localStorage.setItem('steklofurnitura-inquiry',JSON.stringify(products.map((x,i)=>({url:x.url,qty:i+2})))),products.slice(0,40));
await p.goto(base+'/system/cart.html');await p.locator('.cart-row').first().waitFor();
const form=p.locator('#inquiry'),send=p.locator('#send-inquiry'),status=p.locator('#inquiry-status');
await form.locator('[name="name"]').fill('Тестовый покупатель');await form.locator('[name="phone"]').fill('+375 29 0000000');await form.locator('[name="email"]').fill('example@example.com');await form.locator('[name="comment"]').fill('Тест — без реальной отправки');
check(await form.locator('[name="clientType"]').inputValue()==='individual','default client type');
const originalURL=p.url();await send.click();await p.waitForFunction(()=>document.querySelector('#inquiry-status').dataset.state==='success');
let data=requests.at(-1);check(data.client_type==='Физическое лицо'&&data.manager==='Виктория','individual manager');check(data._subject==='[ТЕСТ] СтеклоФурнитура — заявка физического лица','individual subject');
check(data._url===originalURL&&data._template==='table'&&data._honey==='','service fields');
check(data.name==='Тестовый покупатель'&&data.phone==='+375 29 0000000'&&data.email==='example@example.com','contacts');
check(data.message.includes('Тип клиента: Физическое лицо')&&data.message.includes('Специалист: Виктория')&&data.message.includes('Тест — без реальной отправки'),'message fields');
for(const [index,product] of products.slice(0,40).entries())check(data.message.includes(product.article)&&data.message.includes(product.name)&&data.message.includes(`Количество: ${index+2} ${product.unit || 'шт.'}`),'all products/quantities '+product.article);
check(data.message.length>7500,'large request not mailto limited');check(data.message.includes('Количество: 2 '),'quantities');check(data.message.includes('Цену уточняйте'),'unknown price');check(!data.message.includes('/steklofurnitura/steklofurnitura/'),'canonical links');check(p.url()===originalURL,'no navigation');
for(const key of ['_cc','_webhook','_autoresponse','_captcha'])check(!(key in data),'no forbidden field '+key);
check(await send.isDisabled(),'success locked');const count=requests.length;await form.evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));check(requests.length===count,'no accidental resubmit');
check(await p.locator('.cart-row').count()===40,'cart preserved after success');
await p.locator('#inquiry-new').click();await form.locator('[name="clientType"]').selectOption('business');check((await p.locator('#inquiry-manager').innerText()).includes('Назар'),'business info');behavior='boolean';await send.click();await p.waitForFunction(()=>document.querySelector('#inquiry-status').dataset.state==='success');data=requests.at(-1);check(data.client_type==='Юридическое лицо / опт'&&data.manager==='Назар','business manager');check(data._subject==='[ТЕСТ] СтеклоФурнитура — заявка юридического лица / опт','business subject');check(data.message.includes('Специалист: Назар'),'business message');await p.locator('#inquiry-new').click();
for(const kind of ['activation','false','http','network','invalid','timeout']){
 behavior=kind;const prior=requests.length;await send.click();await p.waitForFunction(()=>document.querySelector('#inquiry-status').dataset.state==='error',{},{timeout:20000});
 check(await send.isEnabled(),'error unlock '+kind);check(requests.length===prior+1,'one POST, no retries '+kind);check(await p.locator('.cart-row').count()===40,'cart on error '+kind);check(await form.locator('[name="name"]').inputValue()==='Тестовый покупатель','fields on error '+kind);check(!await form.getAttribute('aria-busy'),'busy cleared '+kind);
 if(kind==='activation')check((await status.innerText()).includes('не активирован'),'activation distinguished');
}
behavior='hold';const prior=requests.length;await send.click();await p.waitForFunction(()=>document.querySelector('#send-inquiry').disabled);await form.evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));check(await send.innerText()==='Отправляем…','pending label');check(await form.getAttribute('aria-busy')==='true','pending ARIA');check(requests.length===prior+1,'double click one POST');release();await p.waitForFunction(()=>document.querySelector('#inquiry-status').dataset.state==='success');
await p.locator('#copy-inquiry').click();await p.waitForFunction(()=>document.querySelector('#copy-inquiry').textContent.includes('Скопировано'));check((await p.evaluate(()=>navigator.clipboard.readText())).includes('Специалист: Назар'),'copy uses same message');
const download=p.waitForEvent('download');await p.locator('#save-inquiry-pdf').click();const file=await download;const pdf=await file.path();check(fs.readFileSync(pdf).subarray(0,8).toString().startsWith('%PDF-1.4'),'PDF');await p.evaluate(()=>{window.print=()=>window.printCalled=true;});await p.locator('#print-inquiry').click();check(await p.evaluate(()=>window.printCalled),'print');
await p.locator('.cart-row').first().locator('[data-qty="1"]').click();check(await p.locator('.cart-row input').first().inputValue()==='3','quantity');
for(const width of [320,360,375,390,430]){await p.setViewportSize({width,height:900});check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile '+width);}
await p.reload();await p.locator('.cart-row').first().waitFor();check(await p.locator('.cart-row input').first().inputValue()==='3','cart persists after reload');
behavior='success';const beforeInvalid=requests.length;await send.click();check(requests.length===beforeInvalid,'native required validation');
await form.locator('[name="name"]').fill('Без email');await form.locator('[name="phone"]').fill('+375290000001');await send.click();await p.waitForFunction(()=>document.querySelector('#inquiry-status').dataset.state==='success');check(!('email' in requests.at(-1)),'email optional');
assert.deepEqual(errors,[]);console.log(`PASS: ${checks} inquiry checks; test-only recipient, strict success, activation/errors/15s timeout, no duplicate POST, all message data, copy/PDF/print/cart and mobile widths`);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
