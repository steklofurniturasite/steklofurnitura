"""Exact-route/article official price verification. stdlib + existing lxml only."""
from __future__ import annotations
import argparse, datetime as dt, decimal, email.utils, gzip, hashlib, http.client, json, math, os, pathlib, re, sys, time
import urllib.request as req
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit, urljoin
from urllib.robotparser import RobotFileParser
from lxml import html
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://www.steklofurnitura.by'
UA='SteklofurnituraPriceSync/1.0 (+https://github.com/steklofurniturasite/steklofurnitura)'
REQUEST='Цену уточняйте'
class VerificationError(ValueError): pass

def now(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def digest(data): return hashlib.sha256(data).hexdigest()
def read(path): return json.loads(path.read_text(encoding='utf8'))
def atomic(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf8');os.replace(temp,path)
def text(e): return ' '.join(e.text_content().split())
def hasclass(name): return f'contains(concat(" ",normalize-space(@class)," ")," {name} ")'
def route(url):
    u=urlsplit(urljoin(BASE+'/',url))
    if u.scheme!='https' or u.hostname not in ('www.steklofurnitura.by','steklofurnitura.by') or u.query or u.fragment or not unquote(u.path).startswith('/catalog/'):
        raise VerificationError('Unexpected official product URL')
    return unquote(u.path)
def visible(e):
    for node in [e,*e.iterancestors()]:
        style=re.sub(r'\s+','',node.get('style','').lower())
        if node.tag in ('s','del','script','style','template','noscript') or 'hidden' in node.attrib or node.get('aria-hidden')=='true' or re.search(r'(display:none|visibility:hidden|opacity:0(?:;|$))',style): return False
        if set(node.get('class','').lower().split()) & {'price-old','old-price','oldprice','hidden','d-none'}: return False
        if 'line-through' in style or re.search(r'(?:^|[ _-])(?:old|previous)(?:[ _-]|$)',node.get('class','').lower()): return False
    return True

def parse_price(body,expected,final_url):
    if route(final_url)!=route(expected['url']): raise VerificationError('Official route redirected to a different product')
    doc=html.fromstring(body)
    wrappers=doc.xpath('//*['+hasclass('tovar-wrapper')+']')
    if len(wrappers)!=1: raise VerificationError('Expected exactly one product detail wrapper')
    w=wrappers[0]
    articles=w.xpath('.//input[starts-with(@name,"article__")]/@value')
    if articles!=[expected['article']]: raise VerificationError('Exact article mismatch')
    row_articles=[text(td) for tr in w.xpath('.//tr') if any(re.fullmatch(r'Арт\.?\s*:',text(th)) for th in tr.xpath('./th')) for td in tr.xpath('./td')]
    if row_articles!=[' '.join(expected['article'].split())]: raise VerificationError('Visible article mismatch')
    links=w.xpath('.//input[starts-with(@name,"linkP__")]/@value')
    if links and (len(links)!=1 or route(links[0])!=route(expected['url'])): raise VerificationError('Product identity link mismatch')
    # Remove old/hidden descendants before reading the current visible value.
    current=[];hidden_price=False;explicit=False
    for td in w.xpath('.//table//td'):
        if not visible(td):
            if re.search(r'\d.*BYN',text(td)): hidden_price=True
            continue
        copy=html.fromstring(html.tostring(td))
        for child in list(copy.iterdescendants())[::-1]:
            if not visible(child) and child.getparent() is not None: child.drop_tree()
        value=text(copy)
        if re.fullmatch(r'Цену\s+уточняйте[.!]?',value,re.I): explicit=True
        if 'BYN' not in value: continue
        row=td.getparent();labels=' '.join(text(x) for x in row.xpath('./th') if visible(x)).lower().replace('c','с')
        if not re.search(r'цен[аы].*с\s*ндс',labels): raise VerificationError('BYN price without visible VAT-inclusive label')
        m=re.fullmatch(r'([0-9]+(?:[ \u00a0\u202f][0-9]{3})*(?:[,.][0-9]{1,2})?)\s*BYN',value)
        if not m: raise VerificationError('Ambiguous current BYN price')
        amount=decimal.Decimal(re.sub(r'[ \u00a0\u202f]','',m[1]).replace(',','.'))
        if not amount.is_finite() or amount<=0 or amount>decimal.Decimal('10000000'): raise VerificationError('Invalid price amount')
        current.append(int(amount*100))
    if len(current)>1 or (current and explicit): raise VerificationError('Conflicting official price states')
    if current: return {'status':'verified','amount_minor':current[0],'currency':'BYN','vat_included':True}
    if explicit: return {'status':'request','amount_minor':None,'currency':'BYN','vat_included':None}
    if hidden_price: return {'status':'unavailable','amount_minor':None,'currency':'BYN','vat_included':None,'reason':'Official numerical price is hidden; no public price confirmed'}
    raise VerificationError('No recognized public price state')

def label(record):
    n=record.get('amount_minor')
    return f'{n//100},{n%100:02d} BYN' if record['status']=='verified' else REQUEST

def validate_manifest(manifest,products):
    if manifest.get('schema')!=1 or manifest.get('source')!=BASE: raise VerificationError('Invalid price manifest schema/source')
    started=dt.datetime.fromisoformat(manifest['started_at']);finished=dt.datetime.fromisoformat(manifest['completed_at'])
    if started.tzinfo is None or finished.tzinfo is None or finished<started or (finished-started).total_seconds()>86400: raise VerificationError('Invalid verification time window')
    entries=manifest.get('products',{})
    if set(entries)!={p['url'] for p in products}: raise VerificationError('Price manifest does not cover the exact complete catalogue')
    for p in products:
        r=entries[p['url']]
        if r['article']!=p['article'] or route(r['source_url'])!=p['url']: raise VerificationError('Manifest identity mismatch')
        if r['status'] not in ('verified','request','unavailable'): raise VerificationError('Unverified product in publishable manifest')
        if not re.fullmatch(r'[0-9a-f]{64}',r['body_sha256']): raise VerificationError('Missing evidence hash')
        checked=dt.datetime.fromisoformat(r['checked_at'])
        if checked.tzinfo is None or not started<=checked<=finished: raise VerificationError('Product timestamp outside verification window')
        n=r['amount_minor']
        if r['status']=='verified':
            if type(n)!=int or not 0<n<=1000000000 or r['currency']!='BYN' or r['vat_included'] is not True: raise VerificationError('Invalid verified amount')
        elif n is not None: raise VerificationError('Unconfirmed amount must be null')
    if manifest.get('complete') is not True: raise VerificationError('Incomplete price manifest')

def validate_catalogue_identity(products):
    baseline=read(ROOT/'data/price-migration-baseline.json')
    canonical=[]
    for p in products:
        if p['url'] not in baseline: raise VerificationError('Unexpected catalogue route')
        route(p['url'])
        original={k:v for k,v in p.items() if k not in ('route','priceAmountMinor','priceStatus','priceCheckedAt')}
        original.update(baseline[p['url']]);canonical.append(original)
    actual=digest(json.dumps(canonical,ensure_ascii=False,sort_keys=True).encode())
    if actual!=(ROOT/'research/catalog-baseline.sha256').read_text().strip(): raise VerificationError('Non-price catalogue integrity failure')


def apply_prices(products,manifest):
    validate_manifest(manifest,list(products.values()))
    for url,p in products.items():
        r=manifest['products'][url]
        p.update(price=label(r),oldPrice='',priceAmountMinor=r['amount_minor'],priceStatus=r['status'],priceCheckedAt=r['checked_at'])

class SafeRedirect(req.HTTPRedirectHandler):
    def __init__(self,client,robots=False): self.client=client;self.is_robots=robots
    def redirect_request(self,request,fp,code,msg,headers,newurl):
        u=urlsplit(newurl)
        if u.scheme!='https' or u.hostname not in ('www.steklofurnitura.by','steklofurnitura.by'):
            raise VerificationError('Off-site or insecure redirect blocked before fetching')
        if self.is_robots:
            if u.path!='/robots.txt' or u.query: raise VerificationError('Unexpected robots redirect')
        elif not self.client.robot.can_fetch(UA,newurl): raise VerificationError('Redirect forbidden by robots.txt')
        else: route(newurl)
        return super().redirect_request(request,fp,code,msg,headers,newurl)


class Client:
    def __init__(self,interval=1.0,retries=3): self.interval=interval;self.retries=retries;self.last=0;self.requests=0;self.retry_count=0;self.robot=None
    def get(self,url,robots=False):
        if not robots and (self.robot is None or not self.robot.can_fetch(UA,url)): raise VerificationError('robots.txt forbids URL')
        for attempt in range(self.retries+1):
            time.sleep(max(0,self.last+self.interval-time.monotonic()));self.last=time.monotonic();self.requests+=1
            try:
                with req.build_opener(SafeRedirect(self,robots)).open(req.Request(quote(url,safe=':/%?=&'),headers={'User-Agent':UA,'Accept':'text/html,text/plain;q=0.9','Accept-Language':'ru'}),timeout=35) as response:
                    if urlsplit(response.url).hostname not in ('www.steklofurnitura.by','steklofurnitura.by'): raise VerificationError('Off-site redirect')
                    data=response.read(4_000_001)
                    if len(data)>4_000_000: raise VerificationError('Response too large')
                    return data,response.url
            except HTTPError as e:
                if e.code not in (408,429,500,502,503,504) or attempt==self.retries: raise
                retry=e.headers.get('Retry-After','')
                try: delay=float(retry)
                except ValueError:
                    try: delay=max(0,(email.utils.parsedate_to_datetime(retry)-dt.datetime.now(dt.timezone.utc)).total_seconds())
                    except (ValueError,TypeError): delay=2**(attempt+1)
                if delay>300: raise VerificationError('Retry-After exceeds run budget; abort without publishing')
            except (URLError,TimeoutError,ConnectionError,http.client.HTTPException):
                if attempt==self.retries: raise
                delay=2**(attempt+1)
            self.retry_count+=1;time.sleep(max(delay,self.interval))
    def robots(self):
        body,_=self.get(BASE+'/robots.txt',robots=True)
        robot=RobotFileParser();robot.parse(body.decode('utf8').splitlines());self.robot=robot
        delay=robot.crawl_delay(UA) or robot.crawl_delay('*')
        rate=robot.request_rate(UA) or robot.request_rate('*')
        self.interval=max(self.interval,float(delay or 0),rate.seconds/rate.requests if rate else 0)
        return body

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--apply',action='store_true',help='Apply only a complete validated run')
    ap.add_argument('--interval',type=float,default=1.0,help='Minimum seconds between requests (>=0.5)')
    ap.add_argument('--work-dir',type=pathlib.Path,default=ROOT/'.price-sync')
    ap.add_argument('--resume',action='store_true',help='Reuse successful evidence from this run for up to 24h')
    args=ap.parse_args()
    if not math.isfinite(args.interval) or not .5<=args.interval<=60: ap.error('Request interval must be finite and between 0.5 and 60 seconds')
    products=read(ROOT/'dist/products.json');validate_catalogue_identity(products)
    work=args.work_dir;work.mkdir(parents=True,exist_ok=True)
    # Back up exact source data before any proposed mutation. Git keeps prior manifests.
    with gzip.open(work/'products-before.json.gz','wt',encoding='utf8') as f: json.dump(products,f,ensure_ascii=False)
    initial=read(ROOT/'data/prices.json') if (ROOT/'data/prices.json').exists() else None
    if initial: atomic(work/'prices-before.json',initial)
    checkpoint=work/'checkpoint.json';stamp=now();records={};errors=[];prior_requests=prior_retries=0
    if len({p['url'] for p in products})!=len(products): raise VerificationError('Duplicate catalogue routes')
    if args.apply and len(products)!=1463: raise VerificationError('Unexpected catalogue size; explicit catalogue migration required')
    if args.resume and checkpoint.exists():
        c=read(checkpoint)
        if (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(c['started_at'])).total_seconds()<86400:
            stamp=c['started_at'];records={p['url']:c['products'][p['url']] for p in products if p['url'] in c['products']}
            metrics=read(work/'summary.json') if (work/'summary.json').exists() else c
            if metrics.get('started_at')==stamp:
                prior_requests=metrics.get('requests',0);prior_retries=metrics.get('retries',0)
    client=Client(args.interval)
    try:
        robot=client.robots();(work/'robots.txt').write_bytes(robot)
    except Exception as e:
        atomic(work/'summary.json',{'found':len(products),'checked':0,'matching':0,'updated':0,'without_public_price':0,'unverified':len(products),'errors':1,'applied':False,'completed_at':now(),'reason':f'robots.txt unavailable: {e}'})
        raise VerificationError('Cannot confirm robots.txt; no product crawl or changes allowed') from e
    consecutive_failures=0
    for i,p in enumerate(products,1):
        url=p['url'];source=BASE+url
        existing=records.get(url)
        needs_fetch=not existing or existing.get('article')!=p['article']
        if needs_fetch:
            try:
                body,final=client.get(source)
                sha=digest(body);evidence=work/'evidence'/f'{sha}.html.gz';evidence.parent.mkdir(exist_ok=True)
                with gzip.open(evidence,'wb') as f:f.write(body)
                result=parse_price(body,p,final)
                records[url]=dict(result,article=p['article'],source_url=source,final_url=final,checked_at=now(),body_sha256=sha)
                consecutive_failures=0
            except Exception as e:
                errors.append({'url':url,'article':p['article'],'error':f'{type(e).__name__}: {str(e)[:220]}'})
                records.pop(url,None)
                atomic(work/'errors.json',errors)
                consecutive_failures+=1
                if (isinstance(e,HTTPError) and e.code in (403,429)) or consecutive_failures>=3:
                    break  # Access denied, outage or template failure: stop rather than burden the server.
        if needs_fetch: atomic(checkpoint,{'started_at':stamp,'products':records,'requests':prior_requests+client.requests,'retries':prior_retries+client.retry_count})
        if i%100==0: print(f'Progress {i}/{len(products)}; confirmed {len(records)}; errors {len(errors)}',flush=True)
    manifest={'schema':1,'source':BASE,'started_at':stamp,'completed_at':now(),'complete':len(records)==len(products) and not errors,'products':records}
    matched=updated=0
    for p in products:
        if p['url'] in records:
            if (p.get('price') or REQUEST)==label(records[p['url']]):matched+=1
            else:updated+=1
    summary={'found':len(products),'checked':len(records),'matching':matched,'updated':updated,'without_public_price':sum(r['status']!='verified' for r in records.values()),'explicit_request':sum(r['status']=='request' for r in records.values()),'hidden_unavailable':sum(r['status']=='unavailable' for r in records.values()),'unverified':len(products)-len(records),'errors':len(errors),'retries':prior_retries+client.retry_count,'requests':prior_requests+client.requests,'started_at':stamp,'completed_at':manifest['completed_at'],'applied':False}
    atomic(work/'candidate.json',manifest);atomic(work/'errors.json',errors)
    atomic(work/'comparison.json',[{'url':p['url'],'article':p['article'],'before':p.get('price') or REQUEST,'after':label(records[p['url']]),'status':records[p['url']]['status']} for p in products if p['url'] in records and (p.get('price') or REQUEST)!=label(records[p['url']])])
    atomic(work/'summary.json',summary)
    if manifest['complete']:
        try:
            validate_manifest(manifest,products)
            # Replay archived evidence before approval to write.
            for p in products:
                r=records[p['url']]
                with gzip.open(work/'evidence'/f'{r["body_sha256"]}.html.gz','rb') as f:body=f.read()
                parsed=parse_price(body,p,r['final_url'])
                if digest(body)!=r['body_sha256'] or parsed!={k:r[k] for k in parsed}: raise VerificationError('Evidence recheck failed')
            if args.apply:
                atomic(ROOT/'data/prices.json',manifest);summary['applied']=True
        except Exception as e:
            summary['errors']+=1;summary['critical_error']=str(e);summary['applied']=False
            atomic(work/'summary.json',summary)
            raise
    atomic(work/'summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
    if not manifest['complete']: return 1
    return 0
if __name__=='__main__':
    try: sys.exit(main())
    except Exception as e: print(f'CRITICAL: {type(e).__name__}: {e}',file=sys.stderr);sys.exit(2)
