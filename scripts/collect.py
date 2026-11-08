"""Read-only snapshot of the public source site; resumable and bounded."""
import concurrent.futures, hashlib, json, pathlib, time, urllib.request, urllib.parse
from lxml import etree, html

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / 'research' / 'pages'
CACHE.mkdir(parents=True, exist_ok=True)
BASE = 'https://www.steklofurnitura.by/'

def fetch(url):
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.html')
    if path.exists():
        return url, str(path.relative_to(ROOT)), None
    for attempt in range(3):
        try:
            safe_url = urllib.parse.quote(url, safe=':/%?=&,+*()')
            req = urllib.request.Request(safe_url, headers={'User-Agent': 'Mozilla/5.0 (compatible; redesign-content-snapshot)'})
            with urllib.request.urlopen(req, timeout=35) as r:
                data = r.read()
            path.write_bytes(data)
            return url, str(path.relative_to(ROOT)), None
        except Exception as e:
            if attempt == 2:
                return url, None, str(e)
            time.sleep(1 + attempt)

if __name__ == '__main__':
    sitemap = etree.parse(str(ROOT / 'research' / 'sitemap.xml'))
    urls = sitemap.xpath('//*[local-name()="loc"]/text()')
    home = html.parse(str(ROOT / 'research' / 'home.html'))
    for href in home.xpath('//a/@href'):
        url = urllib.parse.urljoin(BASE, href).split('#')[0]
        if urllib.parse.urlparse(url).netloc == 'www.steklofurnitura.by' and not any(url.lower().endswith(x) for x in ['.pdf','.jpg','.png','.jpeg','.gif','.zip']):
            urls.append(url)
    urls = sorted(set([BASE] + urls))
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for record in pool.map(fetch, urls):
            records.append({'url': record[0], 'file': record[1], 'error': record[2]})
            if len(records) % 100 == 0:
                print(f'{len(records)}/{len(urls)}, errors: {sum(bool(x["error"]) for x in records)}', flush=True)
    (ROOT / 'research' / 'inventory.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
    print('DONE',len(records),'errors',sum(bool(x['error']) for x in records),flush=True)
