/* Shared, dependency-free search engine. URL paths are never searchable text. */
(function(root) {
  'use strict';
  const text = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[‐‑‒–—−]/g,'-').trim().replace(/\s+/g,' ');
  // Fold visual lookalikes only in code spans containing digits.
  const lookalikes={'а':'a','в':'b','е':'e','к':'k','м':'m','н':'h','о':'o','р':'p','с':'c','т':'t','у':'y','х':'x'};
  const article = value => text(value).replace(/(\d)\s*[хx×]\s*(?=\d)/g,'$1x')
    .replace(/[\s_+\-]/g,'')
    .replace(/[a-zавекмнорстух]*\d[a-z0-9авекмнорстух]*/g,
      code=>code.replace(/[авекмнорстух]/g,char=>lookalikes[char]));
  // Explicit inflections avoid guessing stems in arbitrary names or brand codes.
  const nouns=new Map([
    ['заглушка','заглушки заглушку заглушке заглушкой заглушек заглушкам заглушками заглушках'],
    ['уплотнитель','уплотнители уплотнителя уплотнителю уплотнителем уплотнителе уплотнителей уплотнителям уплотнителями уплотнителях'],
    ['кронштейн','кронштейны кронштейна кронштейну кронштейном кронштейне кронштейнов кронштейнам кронштейнами кронштейнах'],
    ['петля','петли петлю петле петлей петель петлям петлями петлях'],
    ['ручка','ручки ручку ручке ручкой ручек ручкам ручками ручках'],
    ['профиль','профили профиля профилю профилем профиле профилей профилям профилями профилях'],
    ['коннектор','коннекторы коннектора коннектору коннектором коннекторе коннекторов коннекторам коннекторами коннекторах']
  ].flatMap(([base,forms])=>[base,...forms.split(' ')].map(form=>[form,base])));
  const aliases = new Map([['титан','titan'],['дорма','dorma'],['штифгласс','stifglass'],['хаг','hag'],['dormakaba','dorma']]);
  function term(word) {
    word=text(word);
    if(aliases.has(word)) return aliases.get(word);
    if(nouns.has(word)) return nouns.get(word);
    if(/^душев[а-я]*$/.test(word)) return 'душев';
    if(/^хром(?:ирован[а-я]*|овый|овая|овое|овые)?$/.test(word)) return 'хром';
    return word;
  }
  const words = value => (text(value).replace(/(\d)\s*[хx×]\s*(?=\d)/g,'$1x').replace(/stif\s+glass/g,'stifglass').match(/[\p{L}\p{N}]+/gu)||[]).map(term);
  const brandLabels={titan:'Titan',dorma:'DORMA',stifglass:'StifGlass',hag:'HAG'};
  const brands=Object.keys(brandLabels);
  function create(products, categories={}) {
    const tokenCache=new Map();
    const tokenize=value=>{if(!tokenCache.has(value))tokenCache.set(value,words(value));return tokenCache.get(value);};
    const entries=products.map((product,index)=>{
      const metadata=categories[product.route]||categories[product.url]||'';
      const category=typeof metadata==='string'?metadata:metadata.category;
      const context=typeof metadata==='string'?'':metadata.context;
      const articleTokens=tokenize(product.article),nameTokens=tokenize(product.name),contextTokens=tokenize(context);
      // An explicit brand in the article outranks a shared catalogue folder.
      const brand=brands.find(b=>articleTokens.includes(b))
        || brands.find(b=>nameTokens.includes(b))
        || brands.find(b=>contextTokens.includes(b)) || '';
      const tokens=[...nameTokens,...articleTokens,...tokenize(product.finish),...tokenize(category),...contextTokens]
        .filter(token=>!brands.includes(token)||token===brand);
      return {product,index,category,brand,tokens,name:text(product.name),nameTokens,raw:text(product.article),article:article(product.article)};
    });
    function find(query, filters={}) {
      const raw=text(query), terms=words(query), compact=article(query);
      if(!terms.length) return [];
      const articleLike=/\d/.test(raw);
      return entries.flatMap(entry=>{
        if(filters.brand && entry.brand!==filters.brand || filters.category && entry.category!==filters.category) return [];
        let rank=Infinity;
        if(raw===entry.raw) rank=0;
        else if(compact===entry.article) rank=1;
        else if(articleLike && entry.article.startsWith(compact)) rank=2;
        else if(raw===entry.name) rank=3;
        else if(entry.name.startsWith(raw)) rank=4;
        else if(terms.every(t=>entry.nameTokens.some(w=>w.startsWith(t)))) rank=5;
        else if(terms.every(t=>entry.tokens.some(w=>w.startsWith(t)) || /\d/.test(t)&&entry.article.includes(article(t)))) rank=6;
        return Number.isFinite(rank)?[{...entry,rank}]:[];
      }).sort((a,b)=>a.rank-b.rank||a.index-b.index);
    }
    return {find,entries};
  }
  const api={text,article,term,words,brandLabels,create};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.SFSearch=api;
})(typeof globalThis==='undefined'?this:globalThis);
