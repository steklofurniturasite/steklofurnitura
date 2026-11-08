"""Migration checks: real source content, routes, contacts and packaged assets."""
import json,pathlib,re,sys,urllib.parse
from collections import Counter
from lxml import html

ROOT=pathlib.Path(__file__).resolve().parents[1];DIST=ROOT/'dist'
failures=[];checks=Counter()
def check(condition,message,kind):
    checks[kind]+=1
    if not condition:failures.append(message)
def norm(s):return re.sub(r'\s+','',s or '').strip()
def route(path):
    path=urllib.parse.unquote(urllib.parse.urlparse(path).path)
    dest=DIST/path.lstrip('/')
    if path.endswith('/') or not dest.suffix:dest=dest/'index.html'
    return dest
def hasclass(name):return f'contains(concat(" ",normalize-space(@class)," ")," {name} ")'

inv=json.loads((ROOT/'research/inventory.json').read_text());ps=json.loads((DIST/'products.json').read_text());byurl={p['url']:p for p in ps}
for rec in inv:
    if not rec.get('file'):continue
    path=urllib.parse.unquote(urllib.parse.urlparse(rec['url']).path)
    if path=='/system/ajax-search.html':continue
    check(route(path).exists(),'Missing source route '+path,'source routes')
    if path=='/':continue
    source=html.parse(str(ROOT/rec['file']));middle=source.xpath('//*[@id="wrapper"]/*['+hasclass('middle')+']')
    if not middle or not route(path).exists():continue
    middle=middle[0]
    target=html.parse(str(route(path)));text=norm(target.xpath('//main')[0].text_content())
    wrapper=middle.xpath('.//*['+hasclass('tovar-wrapper')+']')
    if wrapper:
        inputs={e.get('name'):e.get('value','') for e in wrapper[0].xpath('.//input')}
        for k,v in inputs.items():
            if (k=='shk-name' or k.startswith('article__') or k.startswith('decorating__')) and v:
                check(norm(v) in text,f'Lost product field {path}: {v}','product fields')
        for intro in middle.xpath('.//*['+hasclass('tovar-intro')+']'):
            for p in intro.xpath('.//p | .//li | .//td | .//th'):
                v=norm(p.text_content())
                if v:check(v in text,f'Lost product description {path}: {v[:120]}','product descriptions')
    elif not middle.xpath('.//*['+hasclass('cat-item')+']') and path not in ['/contacts.html','/gallery.html','/system/cart.html']:
        for p in middle.xpath('.//p | .//li | .//td | .//th'):
            if p.xpath('ancestor::script | ancestor::style | ancestor::form | ancestor::ul['+hasclass('cat-menu')+']'):continue
            content=html.fromstring(html.tostring(p))
            for el in content.xpath('.//script | .//style | .//form'):
                el.drop_tree()
            v=norm(content.text_content())
            if v and len(v)>3:check(v in text,f'Lost information {path}: {v[:140]}','information text')

missing=Counter();img_count=0
for f in DIST.rglob('*.html'):
    if f.name=='qa-mobile.html':continue
    t=html.parse(str(f))
    check(len(t.xpath('//main//h1'))==1,'Expected one heading: '+str(f.relative_to(DIST)),'page headings')
    check(not t.xpath('//script[@src and not(starts-with(@src,"/"))]'),'External script '+str(f),'script isolation')
    for h in t.xpath('//a/@href | //img/@src | //link[@rel="stylesheet"]/@href | //script/@src'):
        if h.startswith('/') and not h.startswith('//'):
            if not route(h).exists() and not (DIST/urllib.parse.unquote(urllib.parse.urlparse(h).path).lstrip('/')).exists():missing[h]+=1
    img_count+=len(t.xpath('//img'))
for p in ps:
    check(route(p['url']).exists(),'Missing product '+p['url'],'product index routes')
    check('Заказать' not in p['stock'],'Order button in stock '+p['article'],'stock extraction')
check(not missing,'Broken internal targets: '+str(missing.most_common(20)),'all internal links')
contact_text=route('/contacts.html').read_text()
for s in ['+375 (29) 633-51-55','+375 (29) 633-51-20','steklofurnitura@mail.ru','steklofurnitura@gmail.com','Независимости, 177','Шафарнянская, 11','офис 30','09:00 - 18:00','09:00 - 17:00']:
    check(s in contact_text,'Missing contact '+s,'contacts')
report={'checks':dict(checks),'failures':failures,'source_records':len(inv),'products':len(ps),'images_referenced':img_count,'missing_targets':dict(missing)}
(ROOT/'research/verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['failures','missing_targets']},ensure_ascii=False,indent=2))
if failures:
    print('FAILURES',len(failures));print('\n'.join(failures[:35]));sys.exit(1)
print('PASS — content and link checks')
