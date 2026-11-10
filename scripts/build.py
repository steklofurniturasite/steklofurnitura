"""Generate the redesigned static site from the verified source snapshot."""
from __future__ import annotations
import copy, gzip, hashlib, html as escape, json, pathlib, re, shutil, urllib.parse
from lxml import html, etree
from functools import lru_cache
from sync_prices import apply_prices

ROOT=pathlib.Path(__file__).resolve().parents[1]
if not (ROOT/'research/pages').exists() and (ROOT/'research/source-snapshot.json.gz').exists():
    with gzip.open(ROOT/'research/source-snapshot.json.gz','rt',encoding='utf8') as source:
        for path,content in json.load(source).items():
            destination=ROOT/path
            destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_text(content,encoding='utf8')
DIST=ROOT/'dist'; DIST.mkdir(exist_ok=True)
BASE='https://www.steklofurnitura.by/'
STATIC=ROOT/'scripts/static'

@lru_cache(maxsize=2)
def static_version(name):
    path=STATIC/name
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12] if path.exists() else 'premium-2'

ALIASES={
    '/articles/shemy-standartnyh-konstrukcij.html':'/info/standartnye-konstrukcii/',
    '/catalog/titan/furnitura-dlya-dushevyh-kabin/profil-uplotnitelnyj/t-210-profil-dlya-stekla-8-mm.html':'/catalog/furnitura-dlya-dushevyix-kabin/titan/profil-uplotnitelnyj/t-210-8mm-belyij-l2500mm-profil-magnitnyij-90°.html',
}
MEDIA={}
if (ROOT/'research/media-map.json').exists():
    MEDIA=json.loads((ROOT/'research/media-map.json').read_text())
ASSETS=set()

def esc(s):return escape.escape(str(s or ''),quote=True)
def cls(name):return f'contains(concat(" ",normalize-space(@class)," ")," {name} ")'
def xp(e,name):return e.xpath('.//*['+cls(name)+']')
def txt(e):return ' '.join(e.text_content().split()) if e is not None else ''
def first(arr):return arr[0] if arr else None
def norm(href):
    u=urllib.parse.urljoin(BASE,href or '')
    p=urllib.parse.urlparse(u)
    if p.netloc in ['www.steklofurnitura.by','steklofurnitura.by']:
        path=urllib.parse.unquote(p.path or '/')
        return ALIASES.get(path,path)+(('?'+p.query) if p.query else '')+(('#'+p.fragment) if p.fragment else '')
    return u
def asset(src):
    if not src:return ''
    url=urllib.parse.urljoin(BASE,src)
    url=urllib.parse.unquote(url)
    ASSETS.add(url)
    return MEDIA.get(url,urllib.parse.quote(url,safe=':/%?=&,+*()'))
def icon(n):
    paths={'arrow':'<path d="M4 12h16M14 6l6 6-6 6"/>','up':'<path d="M6 18 18 6M6 6h12v12"/>','search':'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>','bag':'<path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>','menu':'<path d="M3 6h18M3 12h18M3 18h18"/>','close':'<path d="m5 5 14 14M19 5 5 19"/>','phone':'<path d="m7 3 3 5-2 2a16 16 0 0 0 6 6l2-2 5 3c-1 7-8 3-12-1S1 4 7 3Z"/>','check':'<path d="m5 12 4 4L19 6"/>','download':'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>','pin':'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>','plus':'<path d="M12 5v14M5 12h14"/>'}
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">{paths.get(n,paths["arrow"])}</svg>'

home=html.parse(str(ROOT/'research/home.html')).getroot()
categories=[]; menu=[]
for li in home.xpath('//ul['+cls('cat-menu')+']/li'):
    a=first(li.xpath('./div/a | ./a'))
    if a is None:continue
    obj={'name':txt(a),'url':norm(a.get('href')),'children':[]}
    for sub in li.xpath('.//li'):
        aa=first(sub.xpath('./div/a | ./a'))
        if aa is not None:obj['children'].append({'name':txt(aa),'url':norm(aa.get('href'))})
    if obj['url'] not in [x['url'] for x in menu]:menu.append(obj)
categories=[x for x in menu if x['url'].endswith('/') and x['url'].count('/')==3]

nav=[('О компании','/info/o-kompanii.html'),('Проекты','/gallery.html'),('Полезная информация','/info.html'),('Оплата и доставка','/oplata-i-dostavka.html'),('Контакты','/contacts.html')]
info_nav=[('Стандартные конструкции','/info/standartnye-konstrukcii/'),('Статьи','/articles/'),('Документы','/info/dokumenty.html'),('Видеоруководства','/video.html')]

def header(active=''):
    catlinks=''.join(f'<a href="{esc(x["url"])}">{esc(x["name"])}{icon("arrow")}</a>' for x in menu)
    return f'''<a class="skip" href="#main">К содержимому</a>
    <div class="topbar"><div class="wrap"><span>Фурнитура для стекла и стеклянных конструкций</span><a href="/contacts.html">Минск, пр-т Независимости, 177 {icon('pin')}</a><span>Пн–Чт 09:00–18:00 · Пт 09:00–17:00</span></div></div>
    <header><div class="wrap header-main"><a class="logo" href="/" aria-label="Стеклофурнитура — главная"><img src="{asset('/template/image/logo2.png')}" alt="Стеклофурнитура"><span class="logo-type">Стеклофурнитура</span></a>
    <button class="button catalog-button" data-toggle="catalog-menu" aria-expanded="false" aria-controls="catalog-menu">{icon('menu')}<span>Каталог</span></button>
    <form class="search" action="/search.html" role="search"><input type="search" name="q" aria-label="Поиск по каталогу" placeholder="Название товара или артикул"><button aria-label="Найти">{icon('search')}</button></form>
    <div class="header-phone"><a href="tel:+375296335155">+375 (29) 633-51-55</a><span>Назар · юр. лица и опт</span></div>
    <a class="cart-link" href="/system/cart.html" aria-label="Перейти к заявке">{icon('bag')}<span class="cart-count">0</span></a><button class="mobile-menu icon-btn" data-toggle="mobile-nav" aria-label="Открыть меню" aria-expanded="false" aria-controls="mobile-nav">{icon('menu')}</button></div>
    <nav class="wrap desktop-nav" aria-label="Основная навигация">{''.join(f'<a class="{"active" if active==u else ""}" href="{u}">{n}</a>' for n,u in nav)}<a class="pdf-link" href="{asset('/assets/catalog/Catalog SG 2023.pdf')}" target="_blank" rel="noopener">{icon('download')} Каталог 2023</a></nav>
    <div class="catalog-menu wrap" id="catalog-menu" hidden><div class="menu-heading"><span>Каталог продукции</span><button class="icon-btn" data-toggle="catalog-menu" aria-label="Закрыть каталог">{icon('close')}</button></div><div class="menu-grid">{catlinks}</div></div>
    <nav id="mobile-nav" class="mobile-nav" aria-label="Мобильная навигация" hidden>{''.join(f'<a href="{u}">{n}</a>' for n,u in [('Каталог продукции','/catalog.html'),('Поиск по каталогу','/search.html')]+nav+info_nav)}<a href="tel:+375296335120">Виктория: +375 (29) 633-51-20</a></nav></header>'''

def footer():
    return f'''<footer><div class="wrap footer-lead"><span class="eyebrow">СТЕКЛОФУРНИТУРА / МИНСК</span><h2>Ваша идея.<br><span>Точное решение.</span></h2><a href="/contacts.html" class="button">Обсудить проект {icon("up")}</a></div><div class="wrap footer-grid"><div><a href="/" class="footer-brand">СТЕКЛО<span>ФУРНИТУРА</span></a><p>Фурнитура и крепления для стекла<br> и стеклянных конструкций.</p><a class="footer-download" href="{asset('/assets/catalog/Catalog SG 2023.pdf')}" target="_blank" rel="noopener">Скачать каталог 2023 {icon('download')}</a></div><div><h3>Компания</h3>{''.join(f'<a href="{u}">{n}</a>' for n,u in nav)}</div><div><h3>Полезная информация</h3>{''.join(f'<a href="{u}">{n}</a>' for n,u in info_nav)}</div><div><h3>Связаться с нами</h3><a class="footer-tel" href="tel:+375296335155">+375 (29) 633-51-55</a><span>Назар · юр. лица и опт</span><a href="mailto:steklofurnitura@mail.ru">steklofurnitura@mail.ru</a><a class="footer-tel" href="tel:+375296335120">+375 (29) 633-51-20</a><span>Виктория · физические лица</span><a href="mailto:steklofurnitura@gmail.com">steklofurnitura@gmail.com</a><a href="tel:+375173949470">+375 (17) 394-94-70 (71,72)</a></div></div><div class="wrap footer-bottom"><span>© 2009-2026, ООО «Стеклофурнитура»</span><span>Сайт не является интернет-магазином</span><a href="https://www.instagram.com/steklofurnitura/" target="_blank" rel="noopener">Instagram {icon('up')}</a></div></footer><div class="toast" role="status" aria-live="polite" hidden></div>'''

def shell(title,body,active='',desc=''):
    map_assets = (''
                  f'<script src="/map.js?v={static_version("map.js")}" defer></script>') if 'id="office-map"' in body else ''
    return f'''<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="{esc(desc or 'ООО «Стеклофурнитура». Фурнитура для стекла DORMA, ТИТАН, HAG, StifGlass. Каталог, проекты и контакты в Минске.')} "><meta name="theme-color" content="#c54908"><title>{esc(title)} — Стеклофурнитура</title>{map_assets}<link rel="stylesheet" href="/style.css?v={static_version('style.css')}"><script src="/search.js?v={static_version('search.js')}" defer></script><script src="/app.js?v={static_version('app.js')}" defer></script></head><body>{header(active)}<main id="main">{body}</main>{footer()}</body></html>'''

def clean(el):
    el=copy.deepcopy(el)
    for p in el.xpath('.//p'):
        if len(p.xpath('.//img'))>1 and len(txt(p))<5:
            p.set('class',(p.get('class','')+' photo-strip').strip())
            for node in p.iter():
                if node.text and not node.text.strip():node.text=None
                if node.tail and not node.tail.strip():node.tail=None
    for table in el.xpath('.//table'):
        if len(table.xpath('.//td | .//th'))==1:table.set('class',(table.get('class','')+' layout-table').strip())
    for e in el.xpath('.//script | .//style | .//noscript | .//form | .//input | .//button | .//object | .//embed'):
        if e.getparent() is not None:e.drop_tree()
    for e in el.iter():
        if not isinstance(e.tag,str):continue
        for a in list(e.attrib):
            if e.tag=='img' and a in ['width','height']:continue
            if a.startswith('on') or a in ['style','width','height','border','align','valign','bgcolor','size','face','color']:e.attrib.pop(a,None)
        if e.tag=='a':
            href=e.get('href','')
            if href.lower().startswith('javascript:'):e.attrib.pop('href',None)
            elif re.search(r'\.(mp4|mov|webm)(?:$|\?)',href,re.I):e.set('href',urllib.parse.quote(urllib.parse.urljoin(BASE,href),safe=':/%?=&,+*()'))
            else:e.set('href', norm(href) if not re.search(r'\.(jpg|jpeg|png|gif|pdf|docx?|xlsx?|zip)(?:$|\?)',href,re.I) else asset(href))
            if e.get('target')=='_blank':e.set('rel','noopener')
        if e.tag=='img':
            e.set('src',asset(e.get('src')));e.set('loading','lazy');e.set('alt',e.get('alt') or 'Стеклофурнитура')
        if e.tag=='iframe':
            src=e.get('src','')
            if src.startswith('//'):e.set('src','https:'+src)
            e.set('loading','lazy');e.set('title',e.get('title') or 'Видеоруководство')
    for table in el.xpath('.//table'):
        if 'layout-table' in table.get('class','').split():continue
        parent=table.getparent()
        if parent is None:continue
        container=etree.Element('div',{'class':'table-scroll','role':'region','aria-label':'Таблица: технические сведения','tabindex':'0'})
        parent.replace(table,container);container.append(table)
    return html.tostring(el,encoding='unicode')

def get_input(el,pattern):
    for i in el.xpath('.//input'):
        if re.match(pattern,i.get('name','')):return i.get('value','')
    return ''

def card_data(el):
    a=first(el.xpath('.//a['+cls('item-title')+']'))
    if a is None or not get_input(el,r'article__'):return None
    return {'url':norm(a.get('href')),'name':txt(first(a.xpath('.//span'))),'article':get_input(el,r'article__'), 'finish':get_input(el,r'decorating__'), 'unit':get_input(el,r'unit__'), 'image':first(a.xpath('.//img/@src')) or '', 'price':txt(first(el.xpath('.//*['+cls('prace')+' and not('+cls('price-old')+')]'))),'oldPrice':txt(first(el.xpath('.//s'))),'stock':txt(first(el.xpath('.//*['+cls('stock')+']')))}

products={}
def product_card(p):
    current_price=products.get(p['url'],p).get('price')
    image=asset(p['image'])
    if not image:return ''
    return f'''<article class="product-card"><a class="product-photo" href="{esc(p['url'])}"><img src="{image}" alt="{esc(p['name'])}" loading="lazy"></a><div class="product-content"><span class="product-article">{esc(p['article'])}</span><h3><a href="{esc(p['url'])}">{esc(p['name'])}</a></h3><p class="finish">{esc(p['finish'])}</p><div class="product-stock">Наличие уточняется</div><div class="product-bottom"><span class="product-price">{esc(current_price or 'Цену уточняйте')}</span><small class="price-note">Стоимость подтвердит менеджер</small><button class="add-product" data-product="{esc(p['url'])}" aria-label="Добавить {esc(p['article'])} в заявку"><span>В заявку</span>{icon('plus')}</button></div></div></article>'''

def breadcrumb(crumbs):
    return '<nav class="breadcrumb" aria-label="Хлебные крошки"><a href="/">Главная</a>'+''.join(f'<span aria-hidden="true">/</span>'+ (f'<span aria-current="page">{esc(n)}</span>' if i==len(crumbs)-1 else f'<a href="{esc(u)}">{esc(n)}</a>') for i,(n,u) in enumerate(crumbs))+'</nav>'
def page_title(title,kicker='',sub=''):
    return f'<div class="page-title">{("<span class=eyebrow>"+esc(kicker)+"</span>") if kicker else ""}<h1>{esc(title)}</h1>{("<p>"+esc(sub)+"</p>") if sub else ""}</div>'

gallery=html.parse(str(ROOT/'research/gallery.html')).getroot()
projects=[]
for p in xp(gallery,'project-item'):
    rows=p.xpath('.//table//tr')
    loc=txt(first(rows[0].xpath('./td'))) if rows else ''
    desc=txt(first(rows[1].xpath('./td'))) if len(rows)>1 else ''
    imgs=p.xpath('.//div['+cls('image')+']//a/@href')
    projects.append({'address':loc,'description':desc,'images':imgs})

def project_card(p,i=0):
    return f'<a class="project-card" href="/gallery.html#project-{i}"><div class="project-photo"><img src="{asset(p["images"][0])}" alt="{esc(p["description"])}" loading="lazy"><span class="round-arrow">{icon("up")}</span></div><span class="project-location">{esc(p["address"] or "Стеклянные конструкции")}</span><h3>{esc(p["description"])}</h3></a>'

def home_page():
    card_imgs=[('assets/images/photo_objects/Душевая раздвизжная SF-7A002.jpg',1),('assets/images/photo_objects/8.jpg',2),('assets/images/photo_objects/SP раздвижная 3.jpg',3),('assets/images/photo_objects/Т-102 анод 2.jpg',11)]
    featured=''
    for i,(img,catidx) in enumerate(card_imgs):
        c=categories[catidx] if len(categories)>catidx else categories[i]
        featured+=f'<a class="category-card" href="{esc(c["url"])}"><img src="{asset(img)}" alt="{esc(c["name"])}" loading="lazy"><span class="category-index">0{i+1}</span><div><h3>{esc(c["name"])}</h3><span class="round-arrow">{icon("up")}</span></div></a>'
    extra=''.join(f'<a href="{esc(c["url"])}">{esc(c["name"])}{icon("up")}</a>' for i,c in enumerate(categories) if i not in [1,2,3,11])
    rec=[card_data(x) for x in xp(home,'cat-item')];rec=[p for p in rec if p]
    for p in rec:products.setdefault(p['url'],p)
    brands=''.join(f'<img src="{asset(src)}" alt="{esc(name)}" loading="lazy">' for src,name in [('/assets/images/brand/brand-large1.png','StifGlass'),('/assets/images/brand/dormakaba logo.jpg','dormakaba'),('/assets/images/brand/brand-large3.png','Titan'),('/assets/images/brand/HAG logo.png','HAG')])
    company=clean(first(xp(home,'main-content')))
    return f'''<section class="hero wrap"><div class="hero-top"><span class="eyebrow">СТЕКЛОФУРНИТУРА / МИНСК · С 2009 ГОДА</span><span class="hero-edition">ФУРНИТУРА ДЛЯ СТЕКЛА</span></div><div class="hero-stage"><div class="hero-heading"><h1><span class="hero-materials">Стекло. Металл.</span>Точные <br><span>решения.</span></h1><div class="hero-intro"><p>Крепления и фурнитура, которые становятся частью архитектуры. Для душевых, дверей, перегородок и ограждений.</p><div class="hero-buttons"><a href="/catalog.html" class="button">Смотреть каталог {icon('up')}</a><a href="/gallery.html" class="text-link">Наши проекты {icon('arrow')}</a></div></div></div><div class="hero-visual"><img class="hero-photo" width="900" height="1200" fetchpriority="high" src="{asset('assets/images/photo_objects/dscn5234.jpg')}" alt="Стеклянный козырёк ТРЦ Галилео, реальный проект компании"><a class="hero-caption" href="/gallery.html#project-8"><span>РЕАЛИЗОВАННЫЙ ПРОЕКТ / 08 <b>ТРЦ «Галилео», Минск</b></span>{icon('up')}</a></div></div><div class="hero-panel"><div><span class="eyebrow">ИНЖЕНЕРИЯ В ДЕТАЛЯХ</span><p>От отдельного крепления —<br> к цельной конструкции.</p></div><div class="hero-stats"><div><strong>{len(products)}</strong><span>товара в каталоге</span></div><div><strong>{len(categories):02d}</strong><span>направлений продукции</span></div></div><a href="/contacts.html" class="text-link">Помощь с подбором {icon('arrow')}</a></div></section>
    <section class="brands wrap"><span>Решения проверенных брендов</span><div>{brands}</div></section>
    <section class="section wrap" id="directions"><div class="section-heading"><div><span class="eyebrow">01 / НАПРАВЛЕНИЯ</span><h2>Детали.<br> Системы. Возможности.</h2></div><a class="text-link" href="/catalog.html">Все направления {icon('up')}</a></div><div class="category-grid">{featured}</div><div class="category-rest">{extra}</div></section>
    <section class="about-band"><div class="wrap"><div><span class="eyebrow">02 / КОМПАНИЯ</span><h2>За каждой деталью —<br><span>ваш проект.</span></h2><a href="/info/o-kompanii.html" class="button button-light">О компании {icon('up')}</a></div><div><p>ООО «Стеклофурнитура» работает с 2009 г. и имеет значительный опыт в продаже креплений и фурнитуры для различных стеклянных конструкций.</p><div class="advantages">{''.join(f'<a href="{esc(norm(a.get("href")))}">{icon("check")}<span>{esc(txt(a))}</span>{icon("up")}</a>' for a in home.xpath('//ul['+cls('advantages')+']//a'))}</div></div></div></section>
    <section class="products-section"><div class="wrap section"><div class="section-heading"><div><span class="eyebrow">03 / ПОДБОРКА</span><h2>Точность начинается<br> с выбора.</h2></div><a class="text-link" href="/catalog/novinki.html">Новинки каталога {icon('up')}</a></div><div class="product-grid">{''.join(product_card(p) for p in rec)}</div></div></section>
    <section class="section wrap projects-section"><div class="section-heading"><div><span class="eyebrow">04 / РЕАЛЬНЫЕ ПРОЕКТЫ</span><h2>Из деталей —<br> в архитектуру.</h2></div><a class="text-link" href="/gallery.html">Смотреть проекты {icon('up')}</a></div><div class="projects-preview">{''.join(project_card(projects[i],i) for i in [8,4,5])}</div></section>
    <section class="resources-section"><div class="wrap section"><div class="section-heading"><div><span class="eyebrow">05 / БАЗА ЗНАНИЙ</span><h2>Всё для<br> точного решения.</h2></div><a class="text-link" href="/info.html">Все материалы {icon('up')}</a></div><div class="resource-grid">{''.join(f'<a class="resource-card" href="{u}"><span>0{i+1}</span><h3>{n}</h3>{icon("up")}</a>' for i,(n,u) in enumerate(info_nav))}</div><details class="company-details"><summary>Фурнитура и крепления для стекла <span>Подробнее +</span></summary><div class="prose">{company}</div></details></div></section>
    {contact_band()}'''

def contact_band():
    return f'''<section class="contact-band"><div class="wrap"><div><span class="eyebrow">ПОДБЕРЁМ ФУРНИТУРУ ДЛЯ ВАШЕГО ПРОЕКТА</span><h2>Начнём с консультации?</h2><p>Бесплатная профессиональная консультация.</p></div><a class="button" href="/contacts.html">Связаться с нами {icon('arrow')}</a></div></section>'''

def sidebar(current):
    return '<details class="catalog-nav" open><summary>Разделы каталога'+icon('plus')+'</summary><aside class="sidebar"><h2>Каталог продукции</h2>'+''.join(f'<a class="{"selected" if current.startswith(c["url"]) else ""}" href="{esc(c["url"])}">{esc(c["name"])}</a>' for c in menu)+'</aside></details>'

def read_records():
    inv=ROOT/'research/inventory.json'
    if inv.exists():return json.loads(inv.read_text())
    sm=etree.parse(str(ROOT/'research/sitemap.xml'))
    urls=set(sm.xpath('//*[local-name()="loc"]/text()'))
    for href in home.xpath('//a/@href'):
        u=urllib.parse.urljoin(BASE,href)
        if u.startswith(BASE):urls.add(u)
    return [{'url':u,'file':str((ROOT/'research/pages'/(hashlib.sha256(u.encode()).hexdigest()+'.html')).relative_to(ROOT))} for u in sorted(urls) if (ROOT/'research/pages'/(hashlib.sha256(u.encode()).hexdigest()+'.html')).exists()]

def parse_source(rec):
    t=html.parse(str(ROOT/rec['file'])).getroot()
    middle=first(t.xpath('//*[@id="wrapper"]/*['+cls('middle')+']'))
    if middle is None:return None
    h1=first(middle.xpath('.//h1'));title=txt(h1)
    crumbs=[(txt(a),norm(a.get('href'))) for a in middle.xpath('.//*['+cls('bread')+']//a') if norm(a.get('href'))!='/']
    url=norm(rec['url']).split('?')[0]
    if url!='/' and (not crumbs or crumbs[-1][1]!=url):
        crumbs.append((title or 'Полезная информация',url))
    wrapper=first(xp(middle,'tovar-wrapper'))
    pid=get_input(wrapper if wrapper is not None else etree.Element('div'),r'shk-id$')
    p=None
    if pid:
        el=first(xp(middle,'tovar-wrapper'))
        photos=el.xpath('.//*['+cls('photo-large')+']//a/@href')
        p={'url':url,'name':title,'article':get_input(el,r'article__'),'finish':get_input(el,r'decorating__'),'unit':get_input(el,r'unit__'),'image':first(el.xpath('.//*['+cls('photo-large')+']//img/@src')) or '', 'images':photos,'stock':'','price':'','oldPrice':'','description':''}
        for td in el.xpath('.//td'):
            tx=txt(td)
            if not td.xpath('.//button | .//input') and ('наличии' in tx or re.match(r'^(Под заказ|Нет в наличии)',tx,re.I)):p['stock']=tx
            if 'BYN' in tx:p['price']=tx
        intro=first(xp(middle,'tovar-intro'))
        if intro is not None:p['description']=clean(intro)
        products[url]=p
    return {'url':url,'title':title,'crumbs':crumbs,'tree':middle,'product':p,'source':rec['url'],'description':first(t.xpath('//meta[@name="description"]/@content')) or ''}

def product_page(page,p):
    photos=p.get('images',[])
    primary=asset(photos[0] if photos else p['image'])
    thumbs=''.join(f'<button class="product-thumb" data-image="{asset(src)}" aria-label="Изображение {i+1}" aria-pressed="{str(i==0).lower()}"><img src="{asset(src)}" alt="{esc(p["name"])}" loading="lazy"></button>' for i,src in enumerate(photos))
    related=[x for u,x in products.items() if u.startswith(p['url'].rsplit('/',1)[0]+'/') and u!=p['url']][:4]
    return f'''<div class="wrap">{breadcrumb(page['crumbs'])}<div class="product-heading"><div class="detail-identification"><span class="detail-article">Арт.: {esc(p["article"])}</span><button type="button" class="copy-article text-link" data-copy-article="{esc(p["article"])}" aria-label="Скопировать артикул {esc(p['article'])}">Копировать</button></div><h1>{esc(p["name"])}</h1></div><div class="product-layout"><div class="product-gallery"><a class="product-main-image" href="{primary}" data-lightbox aria-label="Увеличить изображение: {esc(p['name'])}"><img id="detail-photo" src="{primary}" alt="{esc(p['name'])}"><span class="zoom-label">{icon('search')} Увеличить</span></a><div class="product-thumbs">{thumbs}</div></div><div class="product-info"><span class="eyebrow">{esc(page['crumbs'][-2][0]) if len(page['crumbs'])>1 else 'КАТАЛОГ ПРОДУКЦИИ'}</span><h2 class="order-title">Стоимость и заказ</h2><div class="detail-spec"><span>Отделка</span><strong>{esc(p['finish'])}</strong></div><p class="product-stock">Наличие уточняется</p><div class="detail-price">{esc(p['price'] or 'Цену уточняйте')}<small class="price-note">Цена по последней сверке. Итоговую стоимость подтвердит менеджер.</small></div><div class="order-actions"><div class="qty"><button data-qty="-1" aria-label="Уменьшить количество">−</button><input type="number" id="quantity" min="1" max="99999" step="1" inputmode="numeric" value="1" aria-label="Количество"><button data-qty="1" aria-label="Увеличить количество">+</button></div><button class="button" data-product="{esc(p['url'])}">В заявку {icon('plus')}</button><span>{esc(p['unit'])}</span></div><a class="product-consult" href="/contacts.html">Нужна помощь с подбором? {icon('arrow')}</a><a class="detail-jump text-link" href="#product-description">Характеристики и документация {icon("arrow")}</a><div class="product-guarantee"><span>{icon('check')}12 месяцев гарантии</span><span>{icon('check')}Доставка по Беларуси</span></div></div></div><section class="product-description" id="product-description"><h2>Описание и характеристики</h2><div class="prose">{p['description'] or '<p>Подробную информацию уточняйте у наших специалистов.</p>'}</div></section>{('<section class="section"><div class="section-heading"><h2>В этой категории</h2></div><div class="product-grid">'+''.join(product_card(x) for x in related)+'</div></section>') if related else ''}</div>'''

def catalog_page(page):
    url=page['url'];t=page['tree']
    src_cards=[card_data(c) for c in xp(t,'cat-item')];src_cards=[p for p in src_cards if p]
    if url.endswith('/'):
        listing=[p for u,p in products.items() if u.startswith(url)]
    else:listing=[products.get(p['url'],p) for p in src_cards]
    # Stable, unique listing includes every source product, beyond old pagination.
    seen=set();listing=[x for x in listing if not(x['url'] in seen or seen.add(x['url']))]
    series=xp(t,'series-items');serieshtml=''.join(clean(e) for e in series)
    content=copy.deepcopy(t)
    for name in ['cat-items','series-items','bread','series-logo','tovar-wrapper','photos-small']:
        for e in xp(content,name):
            if e.getparent() is not None:e.drop_tree()
    for e in content.xpath('.//h1 | .//form | .//*['+cls('pagination')+'] | .//*['+cls('paginator')+']'):
        if e.getparent() is not None:e.drop_tree()
    for e in content.xpath('.//h2'):
        if txt(e) in ['Товары','Бренды','Вы смотрели']:e.drop_tree()
    extra=clean(content)
    return f'''<div class="wrap">{breadcrumb(page['crumbs'])}{page_title(page['title'],'КАТАЛОГ ПРОДУКЦИИ')}<div class="catalog-layout">{sidebar(url)}<div class="catalog-results">{serieshtml}<div class="catalog-toolbar"><span>Товары <b>{len(listing)}</b></span><label>Сортировка <select id="sort-products"><option value="default">По умолчанию</option><option value="name">По названию</option><option value="article">По артикулу</option></select></label></div><div class="product-grid catalog-products">{''.join(product_card(p) for p in listing)}</div><div class="prose catalog-description">{extra}</div></div></div></div>'''

def contacts_page():
    return f'''<div class="wrap">{breadcrumb([('Контакты','/contacts.html')])}{page_title('Будем на связи','КОНТАКТЫ')}<div class="contacts-grid"><section class="contact-person"><span class="eyebrow">ЮР. ЛИЦА И ОПТОВЫЕ ПРОДАЖИ</span><h2>Назар</h2><a class="contact-tel" href="tel:+375296335155">+375 (29) 633-51-55</a><a href="mailto:steklofurnitura@mail.ru">steklofurnitura@mail.ru {icon('up')}</a><p>+375 (17) 394-94-70 (72) — гор./факс</p><div class="messengers"><a href="viber://chat?number=%2B375296335155">Viber</a><a href="https://wa.me/375296335155" target="_blank" rel="noopener">WhatsApp</a><a href="https://t.me/+375296335155" target="_blank" rel="noopener">Telegram</a></div></section><section class="contact-person"><span class="eyebrow">ФИЗИЧЕСКИЕ ЛИЦА</span><h2>Виктория</h2><a class="contact-tel" href="tel:+375296335120">+375 (29) 633-51-20</a><a href="mailto:steklofurnitura@gmail.com">steklofurnitura@gmail.com {icon('up')}</a><p>+375 (17) 394-94-70 (72) — гор./факс</p><div class="messengers"><a href="viber://chat?number=%2B375296335120">Viber</a><a href="https://t.me/+375296335120" target="_blank" rel="noopener">Telegram</a></div></section></div><div class="address-grid"><div><span class="eyebrow">ПРИЕЗЖАЙТЕ В ГОСТИ</span><h2>Офис и склад в Минске</h2><h3>ОФИС</h3><p>220125, РБ, г.Минск, пр-т Независимости, 177 (БЦ "ПОРТ"), 3 секция, 2 этаж, офис 30</p><h3>СКЛАД</h3><p>г.Минск, ул.Шафарнянская, 11 (соседнее от офиса здание)</p><h3>Режим работы</h3><dl class="hours"><dt>ПН-ЧТ</dt><dd>09:00 - 18:00</dd><dt>ПТ</dt><dd>09:00 - 17:00</dd><dt>СБ, ВС</dt><dd>выходной</dd></dl><a class="button" href="https://yandex.by/maps/?rtext=~53.945793%2C27.682951&rtt=auto" target="_blank" rel="noopener">Построить маршрут {icon('up')}</a></div><div class="map-panel"><div id="office-map" class="office-map" role="region" aria-label="Интерактивная карта офиса в Минске" data-lat="53.945793" data-lng="27.682951"></div><button class="map-reset" type="button" hidden>К офису</button><div class="map-address"><strong>Стеклофурнитура · БЦ «ПОРТ»</strong><p>пр-т Независимости, 177 · офис 30</p><a class="text-link" href="https://yandex.by/maps/?rtext=~53.945793%2C27.682951&rtt=auto" target="_blank" rel="noopener">Построить маршрут {icon('up')}</a></div><p class="map-status" role="status">Карта загрузится при прокрутке. Адрес и маршрут доступны выше.</p></div></div></div>'''

def gallery_page():
    return f'<div class="wrap">{breadcrumb([("Галерея проектов","/gallery.html")])}{page_title("Стекло в архитектуре","ГАЛЕРЕЯ ПРОЕКТОВ")}<div class="full-projects">'+''.join(f'<article class="full-project" id="project-{i}"><a href="{asset(p["images"][0])}" data-lightbox><img src="{asset(p["images"][0])}" alt="{esc(p["description"])}" loading="lazy"></a><div class="project-thumbs">'+''.join(f'<a href="{asset(src)}" data-lightbox><img src="{asset(src)}" alt="Фото проекта" loading="lazy"></a>' for src in p['images'][1:])+f'</div><span class="project-location">{esc(p["address"])}</span><h2>{esc(p["description"])}</h2></article>' for i,p in enumerate(projects))+'</div></div>'+contact_band()

def generic_page(page):
    t=copy.deepcopy(page['tree'])
    for name in ['bread','series-logo']:
        for e in xp(t,name):
            if e.getparent() is not None:e.drop_tree()
    for e in t.xpath('.//h1'):
        if e.getparent() is not None:e.drop_tree()
    # Menus repeated inside the old content are navigation, not article text.
    for e in t.xpath('.//ul['+cls('cat-menu')+']'):
        if e.getparent() is not None:e.drop_tree()
    return f'<div class="wrap">{breadcrumb(page["crumbs"])}{page_title(page["title"] or "Полезная информация")}<div class="information-layout"><nav class="info-sidebar">'+''.join(f'<a href="{u}">{n}{icon("up")}</a>' for n,u in [nav[0]]+info_nav+[nav[3]])+'</nav><article class="prose original-content">'+clean(t)+'</article></div></div>'+contact_band()

def all_catalog():
    covers={categories[i]['url']:img for img,i in [
        ('assets/images/photo_objects/Душевая раздвизжная SF-7A002.jpg',1),
        ('assets/images/photo_objects/8.jpg',2),
        ('assets/images/photo_objects/SP раздвижная 3.jpg',3),
        ('assets/images/photo_objects/Т-102 анод 2.jpg',11)] if len(categories)>i}
    sections=[]
    # Illustrated directions lead to the same complete, unchanged category tree.
    ordered=sorted(enumerate(menu),key=lambda row:row[1]['url'] not in covers)
    for i,c in ordered:
        preview=(f'<a class="category-cover-link" href="{esc(c["url"])}" tabindex="-1" aria-hidden="true"><img class="category-cover" src="{asset(covers[c["url"]])}" alt="" loading="lazy"></a>' if c['url'] in covers else '')
        children=''.join(f'<a href="{esc(x["url"])}">{esc(x["name"])}</a>' for x in c['children'])
        sections.append(f'<section class="{"illustrated-category" if preview else "compact-category"}">{preview}<a class="category-title" href="{esc(c["url"])}"><span>{i+1:02d}</span><h2>{esc(c["name"])}</h2>{icon("up")}</a><div>{children}</div></section>')
    return '<div class="wrap">'+breadcrumb([('Каталог','/catalog.html')])+page_title('Каталог продукции','ФУРНИТУРА ДЛЯ СТЕКЛА')+f'<div class="catalog-intro"><p>Фурнитура для душевых кабин, стеклянных дверей, перегородок и ограждений. Выберите направление или найдите нужный артикул через поиск.</p><a class="text-link" href="/contacts.html">Помощь с подбором {icon("arrow")}</a></div><div class="all-categories">'+''.join(sections)+'</div></div>'

def cart_page():
    return f'''<div class="wrap">{breadcrumb([('Ваш заказ','/system/cart.html')])}{page_title('Ваша заявка','ПОДБОР ФУРНИТУРЫ')}<div class="inquiry-steps"><span>01 / Выберите товары</span><span>02 / Укажите количество</span><span>03 / Передайте менеджеру</span></div><div id="cart-content" aria-live="polite"></div><section class="inquiry-form" id="inquiry-form" hidden><div class="inquiry-heading"><span class="eyebrow">ПОМОЖЕМ С ПОДБОРОМ</span><h2>Оформление заявки</h2><p>Укажите контакты и отправьте список товаров. Стоимость и наличие подтвердит специалист.</p></div><div id="inquiry-test-notice" class="inquiry-test-notice" hidden><strong><span aria-hidden="true">⚙</span> ТЕСТОВЫЙ РЕЖИМ</strong><p>Сейчас заявки отправляются на тестовую почту и не поступают менеджерам компании</p></div><form id="inquiry"><fieldset class="inquiry-clients"><legend>Вы покупаете как</legend><label class="inquiry-client"><input type="radio" name="clientType" value="individual" required checked><span><strong>Физическое лицо</strong><small>Для личных покупок · Виктория</small></span></label><label class="inquiry-client"><input type="radio" name="clientType" value="business" required><span><strong>Юридическое лицо / опт</strong><small>Для организаций и оптовых заявок · Назар</small></span></label></fieldset><div class="form-grid inquiry-fields"><label>Ваше имя<input name="name" autocomplete="name" required placeholder="Как к вам обращаться"></label><div class="inquiry-contact-head"><h3>Как с вами связаться?</h3><p id="inquiry-contact-hint">Укажите номер телефона или email. Можно заполнить оба поля</p></div><label>Телефон<input name="phone" type="tel" autocomplete="tel" placeholder="+375 (__) ___-__-__" aria-describedby="inquiry-contact-hint"></label><label class="inquiry-email">Email<input name="email" type="email" autocomplete="email" placeholder="name@example.com" aria-describedby="inquiry-contact-hint"></label><div class="inquiry-contact-error-slot"><p id="inquiry-contact-error" role="alert" hidden>Укажите номер телефона или email, чтобы мы могли с вами связаться</p></div><label class="inquiry-comment">Комментарий <span class="inquiry-optional">необязательно</span><textarea name="comment" rows="3" placeholder="Уточнения по подбору, количеству или доставке"></textarea></label></div><p id="inquiry-manager" class="inquiry-manager" aria-live="polite">Ваш специалист: Виктория</p><label class="inquiry-honey" aria-hidden="true">Оставьте это поле пустым<input name="_honey" tabindex="-1" autocomplete="off"></label><div class="inquiry-status-slot"><p class="inquiry-ready">Контакты и состав заявки передаются сервису FormSubmit для обработки и отправки письма.</p><div id="inquiry-status" class="inquiry-status" role="status" tabindex="0" aria-label="Статус отправки заявки" aria-live="polite" hidden><span id="inquiry-status-icon" aria-hidden="true"></span><div><strong id="inquiry-status-title"></strong><span id="inquiry-status-text"></span></div></div></div><button type="button" class="text-link" id="inquiry-new" hidden>Подготовить новую заявку</button><div class="inquiry-send-row"><button class="button" type="submit" id="send-inquiry"><span>Отправить заявку</span>{icon('arrow')}</button></div><div class="inquiry-tools" aria-label="Сохранить заявку"><button class="text-link" type="button" id="copy-inquiry">Скопировать список</button><button class="text-link" type="button" id="save-inquiry-pdf">Сохранить в PDF</button><button class="text-link" type="button" id="print-inquiry">Распечатать</button></div><p class="inquiry-footnote">Товары сохраняются в этом браузере. Можно скопировать, сохранить или распечатать заявку. Сайт не является интернет-магазином.</p></form></section></div>'''

def write_page(path,title,body,desc=''):
    path=path.split('?')[0].split('#')[0]
    if path.endswith('/'):path+='index.html'
    if path=='':path='index.html'
    dest=DIST/path.lstrip('/')
    if not dest.suffix:dest=dest/'index.html'
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(shell(title,body,path,desc),encoding='utf8')

if __name__=='__main__':
    for name in ['style.css','app.js','map.js','search.js']:
        shutil.copyfile(STATIC/name,DIST/name)
    shutil.copytree(STATIC/'vendor',DIST/'vendor',dirs_exist_ok=True)
    records=read_records();pages=[]
    for r in records:
        if not r.get('file'):continue
        try:
            p=parse_source(r)
            if p and p['url']!='/':pages.append(p)
        except Exception as e:print('PARSE ERROR',r['url'],str(e),flush=True)
    # Source recommendations may include non-sitemap entries.
    for r in records:
        if not r.get('file'):continue
        t=html.parse(str(ROOT/r['file'])).getroot()
        for el in xp(t,'cat-item'):
            p=card_data(el)
            if p:
                if p['url'] not in products:products[p['url']]=p
                else:
                    for key in ['stock','price','oldPrice']:
                        if p.get(key):products[p['url']][key]=p[key]
    price_file=ROOT/'data/prices.json'
    if not price_file.exists(): raise RuntimeError('Missing verified prices; run scripts/sync_prices.py --apply first')
    apply_prices(products,json.loads(price_file.read_text()))
    write_page('/','Фурнитура для стеклянных конструкций',home_page())
    write_page('/catalog.html','Каталог продукции',all_catalog())
    for page in pages:
        url=page['url']
        if url in ['/contacts.html','/gallery.html','/system/cart.html','/search.html','/system/search.html']:continue
        if page['product']:body=product_page(page,page['product'])
        elif url.startswith('/catalog/') and (xp(page['tree'],'cat-item') or xp(page['tree'],'series-items')):body=catalog_page(page)
        else:body=generic_page(page)
        write_page(url,page['title'],body,page['description'])
    write_page('/contacts.html','Контакты',contacts_page())
    write_page('/gallery.html','Галерея проектов',gallery_page())
    write_page('/system/cart.html','Ваш заказ',cart_page())
    write_page('/search.html','Поиск по каталогу',f'<div class="wrap">{breadcrumb([("Поиск","/search.html")])}{page_title("Поиск по каталогу")}<form action="/search.html" class="large-search" role="search"><input type="search" name="q" id="search-query" aria-label="Название или артикул" placeholder="Введите название или артикул"><button class="button">Найти {icon("search")}</button></form><p id="search-summary" aria-live="polite"></p><div id="search-filters" class="search-filters" hidden></div><div id="search-results" class="product-grid section"></div><button type="button" class="button" id="search-more" hidden>Показать ещё</button></div>')
    shutil.copyfile(DIST/'search.html',DIST/'system/search.html')
    page_context={p['url']:' '.join(n for n,u in p['crumbs'][:-1]) for p in pages if p['product']}
    search_categories={p['url']:{'category':next((c['name'] for c in categories if p['url'].startswith(c['url'])), ''), 'context':page_context.get(p['url'],'')} for p in products.values()}
    (DIST/'search-categories.json').write_text(json.dumps(search_categories,ensure_ascii=False,separators=(',',':')))
    index=[]
    for p in products.values():
        index.append({k:v for k,v in p.items() if k not in ['description','images'] }|{'image':asset(p['image']), 'route':p['url']})
    (DIST/'products.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')))
    (ROOT/'research/asset-urls.json').write_text(json.dumps(sorted(ASSETS),ensure_ascii=False,indent=2))
    page_count=sum(1 for _ in DIST.rglob('*.html'))
    (ROOT/'research/build-report.json').write_text(json.dumps({'source_records':len(records),'pages':page_count,'products':len(products),'categories':len(categories),'assets':len(ASSETS),'source_urls':[p['url'] for p in pages]},ensure_ascii=False,indent=2))
    print('BUILT',page_count,'pages;',len(products),'products;',len(categories),'categories;',len(ASSETS),'assets',flush=True)
