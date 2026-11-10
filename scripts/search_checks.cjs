const assert=require('node:assert/strict'),fs=require('node:fs'),S=require('./static/search.js');
const products=JSON.parse(fs.readFileSync('dist/products.json')),categories=JSON.parse(fs.readFileSync('dist/search-categories.json'));
const engine=S.create(products,categories);let passed=0;const check=(condition,message)=>{assert(condition,message);passed++;};
for(const p of products){
 const variants=new Set([p.article,p.article.toLowerCase(),p.article.toUpperCase(),p.article.replace(/[\s-]/g,''),...[' ','—','−','_','‑'].map(sep=>p.article.replace(/-/g,sep)),p.article.replace(/(\d)[xх×](?=\d)/g,'$1×')]);
 for(const q of variants){const found=engine.find(q);check(found.some(r=>r.product.url===p.url),'missing article: '+q);}
 const found=engine.find(p.article);check(found[0].raw===S.text(p.article),'exact priority: '+p.article);
}
for(const q of ['SP-1009','SP1009','SP 1009','SP—1009','SP−1009','SP_1009','SR-670 32x325x500 SSS'])check(engine.find(q).length>0,q);
for(const [a,b] of [['Titan','Титан'],['DORMA','Дорма'],['StifGlass','Штифгласс'],['HAG','ХАГ'],['душевой','душевая'],['душевые','душевой'],['хром','хромированный'],['17x30','17х30']]){const first=engine.find(a).map(r=>r.product.url),second=engine.find(b).map(r=>r.product.url);check(first.length>0,a+' empty');check(JSON.stringify(first)===JSON.stringify(second),a+' alias mismatch');}
for(const q of ['catalog','html','','   ','---','___','×','?!','<script>alert(1)</script>','SP100999999'])check(engine.find(q).length===0,'false result '+q);
for(const q of ['х','x'])check(engine.find(q).length<products.length/2,'mass results '+q);
const fixture=S.create([
 {url:'/one',article:'AB-12X',name:'Держатель',finish:''},
 {url:'/two',article:'AB-12',name:'Держатель',finish:''},
 {url:'/three',article:'AB-12',name:'Держатель',finish:''},
 {url:'/four',article:'AB-13',name:'Держатель',finish:''},
]);
check(fixture.find('AB-12').slice(0,2).every(r=>r.product.article==='AB-12'),'duplicate articles retained/first');
check(!fixture.find('AB12X').some(r=>r.product.article==='AB-12'),'significant X retained');
check(S.article('17х30')===S.article('17x30'),'dimension x alias');check(S.article('AX')!==S.article('A'),'letter x retained');
const ranked=S.create([
 {article:'Q77',name:'Держатель',finish:'AB 12'},
 {article:'Q76',name:'12 AB',finish:''},
 {article:'Q75',name:'AB-12 держатель',finish:''},
 {article:'Q74',name:'AB-12',finish:''},
 {article:'AB123',name:'Держатель',finish:''},
 {article:'AB12',name:'Держатель',finish:''},
 {article:'AB-12',name:'Держатель',finish:''}
]);
check(JSON.stringify(ranked.find('AB-12').map(r=>r.rank))===JSON.stringify([0,1,2,3,4,5,6]),'seven ranking tiers');
// PR #2 regression fixes: exact inflections, code lookalikes, plus and brand evidence.
for(const [singular,plural] of [['заглушка','заглушки'],['уплотнитель','уплотнители'],['кронштейн','кронштейны']]) {
 const single=engine.find(singular).map(r=>r.product.url).sort(),multiple=engine.find(plural).map(r=>r.product.url).sort();
 check(single.length>0,'noun has results '+singular);
 check(JSON.stringify(single)===JSON.stringify(multiple),'noun forms equivalent '+plural);
}
for(const word of ['заглушкин','уплотнительность','кронштейнер'])check(S.term(word)===word,'unrelated word retained '+word);
for(const [query,article] of [['TT505A SSS','TT-505А SSS'],['SP1009ALSSS','SP-1009 AL+SSS']]) {
 const found=engine.find(query);check(found[0]?.product.article===article,'code regression '+query);
 check(engine.find(article)[0].raw===S.text(article),'raw code still first '+article);
}
for(const [a,b] of [['TT505Б','TT505B'],['AB10','AB1O'],['AB12X','AB12'],['AB12/3','AB123'],['AB12*3','AB123']])check(S.article(a)!==S.article(b),'significant code retained '+a);
for(const [a,b] of [['ТТ-505А','TT505A'],['КР-12Н','KP12H'],['SP-1009 AL+SSS','SP1009ALSSS']])check(S.article(a)===S.article(b),'visual/separator alias '+a);
const lookalikeFixture=S.create([{url:'/latin',article:'TT-505A SSS',name:'Крепление'}, {url:'/cyrillic',article:'TT-505А SSS',name:'Крепление'}, {url:'/different',article:'TT-505Б SSS',name:'Крепление'}]);
check(lookalikeFixture.find('TT-505A SSS')[0].product.url==='/latin','Latin exact outranks normalized');
check(lookalikeFixture.find('TT-505А SSS')[0].product.url==='/cyrillic','Cyrillic exact outranks normalized');
check(!lookalikeFixture.find('TT505A SSS').some(r=>r.product.url==='/different'),'nonvisual Cyrillic letter distinct');
for(const article of ['HAG PS-16S','HAG PS-8S']) {
 check(engine.entries.find(r=>r.product.article===article)?.brand==='hag','article brand wins '+article);
 check(engine.find('HAG',{brand:'hag'}).some(r=>r.product.article===article),'HAG filter retains '+article);
 check(!engine.find('StifGlass').some(r=>r.product.article===article),'folder brand suppressed '+article);
}
check(engine.find('HAG').length===engine.find('HAG',{brand:'hag'}).length,'HAG search/filter agree');
check(JSON.stringify(Object.values(S.brandLabels))===JSON.stringify(['Titan','DORMA','StifGlass','HAG']),'brand label casing');
const start=performance.now();for(let i=0;i<100;i++)engine.find(i%2?'душевой хром':'SP1009');
console.log(`PASS: ${passed} assertions, ${products.length} articles and format variants; 100 queries ${(performance.now()-start).toFixed(0)}ms`);
