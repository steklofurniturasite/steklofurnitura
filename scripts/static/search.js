/* Shared, dependency-free search engine. URL paths are never searchable text. */
(function(root) {
  'use strict';
  const text = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[‐‑‒–—−]/g,'-').trim().replace(/\s+/g,' ');
  const article = value => text(value).replace(/(\d)\s*[хx×]\s*(?=\d)/g,'$1x').replace(/[\s_\-]/g,'');
  const aliases = new Map([['титан','titan'],['дорма','dorma'],['штифгласс','stifglass'],['хаг','hag'],['dormakaba','dorma']]);
  function term(word) {
    word=text(word);
    if(aliases.has(word)) return aliases.get(word);
    if(/^душев[а-я]*$/.test(word)) return 'душев';
    if(/^хром(?:ирован[а-я]*|овый|овая|овое|овые)?$/.test(word)) return 'хром';
    return word;
  }
  const words = value => (text(value).replace(/(\d)\s*[хx×]\s*(?=\d)/g,'$1x').replace(/stif\s+glass/g,'stifglass').match(/[\p{L}\p{N}]+/gu)||[]).map(term);
  const brands=['titan','dorma','stifglass','hag'];
  function create(products, categories={}) {
    const entries=products.map((product,index)=>{
      const metadata=categories[product.route]||categories[product.url]||'';
      const category=typeof metadata==='string'?metadata:metadata.category;
      const context=typeof metadata==='string'?'':metadata.context;
      const tokens=words([product.name,product.article,product.finish,category,context].join(' '));
      const brand=brands.find(b=>tokens.includes(b))||'';
      return {product,index,category,brand,tokens,name:text(product.name),nameTokens:words(product.name),raw:text(product.article),article:article(product.article)};
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
  const api={text,article,term,words,create};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.SFSearch=api;
})(typeof globalThis==='undefined'?this:globalThis);
