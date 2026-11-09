/* Motion regression: entry, exit, rapid interruption and reduced-motion. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({
  executablePath:process.env.CHROMIUM_PATH||undefined,
  headless:true,args:['--no-sandbox']
 });
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const origin=process.env.TEST_ORIGIN||'http://127.0.0.1:8000';
  const base=process.env.TEST_BASE===undefined?'/steklofurnitura':process.env.TEST_BASE;
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+base+'/');
  const menu=page.locator('#catalog-menu');
  const toggle=page.locator('[data-toggle="catalog-menu"]').first();
  assert.equal(await menu.isHidden(),true);
  await toggle.click();
  assert.equal(await menu.isVisible(),true);
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  assert((await menu.evaluate(e=>getComputedStyle(e).animationName)).includes('motion-panel-enter'));
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await page.waitForTimeout(260);
  assert.equal(await menu.isHidden(),true);
  // Rapid reopening must cancel a pending exit rather than close the panel later.
  await toggle.click();
  await toggle.click();
  await toggle.click();
  await page.waitForTimeout(300);
  assert.equal(await menu.isVisible(),true);
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(240);
  assert.equal(await menu.isHidden(),true);
  // Reduced-motion must close instantly without a delayed animation.
  await page.emulateMedia({reducedMotion:'reduce'});
  await toggle.click();
  assert.equal(await menu.isVisible(),true);
  await toggle.click();
  assert.equal(await menu.isHidden(),true);
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  // Product card remains visible; hover is never needed to reveal it.
  assert(await page.locator('.product-card').first().isVisible());
  // Check desktop and mobile styles at representative sizes.
  for(const width of [375,1440]){
   await page.setViewportSize({width,height:850});
   await page.goto(origin+base+'/');
   const metrics=await page.evaluate(()=>({
     viewport:window.innerWidth,
     document:document.documentElement.scrollWidth
   }));
   console.log('Motion responsive layout',width,metrics);
   assert(metrics.document<=metrics.viewport+1, 'overflow at '+width+'px');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: motion menus, rapid interruption, keyboard, reduced-motion, layouts');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
