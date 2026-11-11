"""Validate both SEO modes and all generated canonical content without network calls."""
import json,sys,tempfile
from pathlib import Path
from urllib.parse import urlsplit,unquote
from collections import Counter
from lxml import html,etree
import seo
root=Path(__file__).resolve().parents[1];dist=root/'dist';cfg=seo.CONFIG
seo.validate(cfg)
if cfg['siteOrigin'].endswith('github.io'):assert cfg['indexingEnabled'] is False
seen={};descriptions=Counter();titles=Counter();products=0
for path in dist.rglob('*.html'):
    t=html.parse(str(path));title=t.xpath('//title/text()');desc=t.xpath('//meta[@name="description"]/@content')
    assert len(title)==len(desc)==1 and title[0].strip() and desc[0].strip(),path
    canonical=t.xpath('//link[@rel="canonical"]/@href')
    expected='index,follow' if cfg['indexingEnabled'] and canonical else 'noindex,follow'
    assert t.xpath('//meta[@name="robots"]/@content')==[expected],path
    if canonical:
        assert len(canonical)==1 and canonical[0].startswith(seo.absolute('/',cfg)),path
        route=unquote(urlsplit(canonical[0]).path.removeprefix(cfg['basePath']))
        target=dist/route.lstrip('/');assert target.is_file() or (target/'index.html').is_file(),(path,route)
        assert canonical[0] not in seen,(path,seen.get(canonical[0]));seen[canonical[0]]=path
        titles[title[0]]+=1;descriptions[desc[0]]+=1
    for key in ['og:title','og:description','og:type','og:url','og:site_name']:assert t.xpath('//meta[@property=$x]/@content',x=key),path
    graph=json.loads(t.xpath('//script[@type="application/ld+json"]/text()')[0])
    for obj in graph:
        assert 'offers' not in obj and 'aggregateRating' not in obj and 'review' not in obj
        if obj['@type']=='Product':
            products+=1;assert obj.get('sku') and obj.get('name') and obj.get('image'),path
            photo=t.xpath('//*[@id="detail-photo"]/@src');assert photo and photo[0] and (dist/photo[0].lstrip('/')).is_file(),path
            assert '12 месяцев гарантии' not in ''.join(t.xpath('//*[contains(@class,"product-guarantee")]//text()'))
assert products==1463,products
assert max(titles.values())==1,[(x,n) for x,n in titles.items() if n>1][:3]
assert max(descriptions.values())==1,[(x,n) for x,n in descriptions.items() if n>1][:3]
urls=etree.parse(str(dist/'sitemap.xml')).xpath('//*[local-name()="loc"]/text()')
assert len(urls)==len(set(urls)) and set(urls)==set(seen)
robots=(dist/'robots.txt').read_text();assert 'Disallow:' not in robots and ('Sitemap:' in robots)==cfg['indexingEnabled']
live={'indexingEnabled':True,'siteOrigin':'https://shop.example','basePath':''}
for config in [cfg,live,dict(live,basePath='/shop')]:
    output=seo.head('Категория','','/catalog/test/','<h1>Категория</h1>',cfg=config)
    t=html.fromstring(output);assert t.xpath('//link[@rel="canonical"]/@href')==[seo.absolute('/catalog/test/',config)]
    assert t.xpath('//meta[@name="robots"]/@content')==['index,follow' if config['indexingEnabled'] else 'noindex,follow']
    with tempfile.TemporaryDirectory() as tmp:
        d=Path(tmp);(d/'index.html').write_text(output);seo.write_maps(d,config)
        assert ('Sitemap:' in (d/'robots.txt').read_text())==config['indexingEnabled']
try:seo.validate({'indexingEnabled':True,'siteOrigin':'https://preview.github.io','basePath':'/test'})
except AssertionError:pass
else:raise AssertionError('GitHub Pages indexing enabled without a confirmed domain')
print(f'PASS: {len(seen)} canonical pages, {products} Product schemas, unique metadata, sitemap and test/live/root/subpath SEO modes')
