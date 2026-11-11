"""Static launch metadata. Indexing is an explicit, independent deployment choice."""
import json,re
from html import escape
from pathlib import Path
from urllib.parse import urlsplit,quote
from lxml import html,etree
ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'scripts/site_config.json').read_text())
def validate(cfg):
    origin=urlsplit(cfg['siteOrigin'])
    assert origin.scheme=='https' and origin.netloc and origin.path in ('','/'), 'siteOrigin must be an HTTPS origin without a path'
    assert not (origin.query or origin.fragment or origin.username or origin.password), 'siteOrigin must not contain query, fragment or credentials'
    assert isinstance(cfg['indexingEnabled'],bool)
    if cfg['indexingEnabled']:assert not origin.hostname.endswith('github.io'),'Confirm an official domain before enabling indexing'
    assert not cfg['basePath'] or cfg['basePath'].startswith('/') and '..' not in cfg['basePath']
def absolute(route,cfg=CONFIG):
    validate(cfg)
    return cfg['siteOrigin'].rstrip('/')+cfg['basePath'].rstrip('/')+quote(route,safe='/%:@-._~')
def service(route):return route.startswith('/system/') or route=='/search.html'
def compact(value,limit=190):
    value=re.sub(r'\s+',' ',value).strip()
    return value if len(value)<=limit else value[:limit-1].rsplit(' ',1)[0]+'…'
def head(title,desc,route,body,product=None,cfg=CONFIG):
    tree=html.fragment_fromstring(body,create_parent='div');h1=' '.join(tree.xpath('.//h1//text()')).strip() or title
    parents=[node.text_content().strip() for node in tree.xpath('.//nav[@class="breadcrumb"]/a') if node.text_content().strip()!='Главная']
    context=' · '.join(parents)
    if product:
        title=f"{product['name']} — {product['article']}"+(f" · {product['finish']}" if product.get('finish') else '')
        desc=f"{product['name']}. Артикул: {product['article']}. "+(f"Отделка: {product['finish']}. " if product.get('finish') else '')+'Стоимость и наличие уточняются.'
    else:
        intro=' '.join(tree.xpath('.//main/p//text() | .//*[contains(concat(" ",@class," ")," prose ")]//p[1]//text()'))
        desc=desc or compact(intro) or f'{h1}. Информация и материалы компании «Стеклофурнитура».'
        if route=='/':desc='Каталог фурнитуры для стекла. Артикулы, характеристики, проекты и контакты ООО «Стеклофурнитура». Стоимость и наличие уточняются.'
        if '/page-' in route:desc=f'{h1}. {desc}'
    if not product and not desc.startswith(h1):desc=h1+'. '+desc
    if context and route.startswith('/catalog/'):
        title+=' · '+context
        desc=context+'. '+desc
    title=title+' — Стеклофурнитура';desc=compact(desc)
    url=absolute(route,cfg);robots='index,follow' if cfg['indexingEnabled'] and not service(route) else 'noindex,follow'
    image=next(iter(tree.xpath('.//img/@src')),None)
    if image and not image.startswith('/'):image=None
    graph=[{'@context':'https://schema.org','@type':'Organization','name':'ООО «Стеклофурнитура»','url':absolute('/',cfg)}]
    crumbs=[]
    for node in tree.xpath('.//nav[@class="breadcrumb"]/*[self::a or @aria-current="page"]'):
        href=node.get('href') or route
        if href.startswith('/'):crumbs.append({'@type':'ListItem','position':len(crumbs)+1,'name':node.text_content().strip(),'item':absolute(href,cfg)})
    if crumbs:graph.append({'@context':'https://schema.org','@type':'BreadcrumbList','itemListElement':crumbs})
    if product:
        item={'@context':'https://schema.org','@type':'Product','name':product['name'],'sku':product['article'],'url':url}
        if image:item['image']=absolute(image,cfg)
        if product.get('finish'):item['additionalProperty']=[{'@type':'PropertyValue','name':'Отделка','value':product['finish']}]
        graph.append(item)
    tags=f'<title>{escape(title)}</title><meta name="description" content="{escape(desc,quote=True)}"><meta name="robots" content="{robots}">'
    if not service(route):tags+=f'<link rel="canonical" href="{escape(url,quote=True)}">'
    for key,value in [('og:title',title),('og:description',desc),('og:type','product' if product else 'website'),('og:url',url),('og:site_name','Стеклофурнитура')]+([('og:image',absolute(image,cfg))] if image else []):
        tags+=f'<meta property="{key}" content="{escape(value,quote=True)}">'
    tags+=f'<meta name="twitter:card" content="{"summary_large_image" if image else "summary"}"><meta name="twitter:title" content="{escape(title,quote=True)}"><meta name="twitter:description" content="{escape(desc,quote=True)}">'
    if image:tags+=f'<meta name="twitter:image" content="{escape(absolute(image,cfg),quote=True)}">'
    return tags+'<script type="application/ld+json">'+json.dumps(graph,ensure_ascii=False).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')+'</script>'
def write_maps(dist,cfg=CONFIG):
    validate(cfg);ns='http://www.sitemaps.org/schemas/sitemap/0.9';root=etree.Element('{'+ns+'}urlset',nsmap={None:ns});seen=set()
    for path in sorted(dist.rglob('*.html')):
        tree=html.parse(str(path));values=tree.xpath('//link[@rel="canonical"]/@href')
        if not values or values[0] in seen:continue
        seen.add(values[0]);node=etree.SubElement(root,'{'+ns+'}url');etree.SubElement(node,'{'+ns+'}loc').text=values[0]
    (dist/'sitemap.xml').write_bytes(etree.tostring(root,encoding='utf-8',xml_declaration=True))
    text='User-agent: *\nAllow: /\n'
    text+=('Sitemap: '+absolute('/sitemap.xml',cfg)+'\n') if cfg['indexingEnabled'] else '# Test deployment: HTML meta robots is noindex,follow. Do not submit this sitemap.\n'
    (dist/'robots.txt').write_text(text)
