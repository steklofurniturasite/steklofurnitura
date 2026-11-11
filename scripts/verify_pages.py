"""Fail deployment on missing files, broken prepared URLs or changed snapshot data."""
import hashlib
import json
import pathlib
import sys
from urllib.parse import unquote, urlsplit
from lxml import html
from sync_prices import validate_manifest, label

ROOT = pathlib.Path(__file__).resolve().parents[1]
base = sys.argv[1] if len(sys.argv) > 1 else json.loads((ROOT/'scripts/site_config.json').read_text())['basePath'].rstrip('/')
out = ROOT / (sys.argv[2] if len(sys.argv) > 2 else '.github-pages')
for name in ['index.html', 'catalog.html', 'search.html', 'system/cart.html', 'contacts.html',
             'app.js', 'style.css', 'products.json', 'sitemap.xml', 'robots.txt', '.nojekyll', '404.html']:
    assert (out / name).is_file(), f'Missing required output: {name}'
assert 'наименований на складе' not in (out/'index.html').read_text(), 'Unconfirmed homepage inventory'
source = json.loads((ROOT/'dist/products.json').read_text())
manifest=json.loads((ROOT/'data/prices.json').read_text())
validate_manifest(manifest,source)
baseline=json.loads((ROOT/'data/price-migration-baseline.json').read_text())
canonical=[]
for product in source:
    record=manifest['products'][product['url']]
    assert product['price']==label(record) and product['oldPrice']=='', 'Published price differs from verified source'
    assert product['priceAmountMinor']==record['amount_minor'] and product['priceStatus']==record['status'] and product['priceCheckedAt']==record['checked_at'], 'Price metadata mismatch'
    old={k:v for k,v in product.items() if k not in ('route','priceAmountMinor','priceStatus','priceCheckedAt')}
    old.update(baseline[product['url']]);canonical.append(old)
digest = hashlib.sha256(json.dumps(canonical,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
assert digest == (ROOT/'research/catalog-baseline.sha256').read_text().strip(), 'Non-price catalogue data or original backup changed'
prepared = json.loads((out/'products.json').read_text())
assert len(source) == len(prepared) == 1463
for original, product in zip(source, prepared):
    assert product['route'] == original['url'], 'Canonical route was rewritten'
    for key in original:
        expected = base + original[key] if key in ('url','image') and original[key].startswith('/') and not original[key].startswith('//') else original[key]
        assert product[key] == expected, f'Incorrect prepared product {key}'
count=0
for path in out.rglob('*.html'):
    tree = html.parse(str(path))
    for link in tree.xpath('//a/@href | //img/@src | //script/@src | //link[@rel="stylesheet"]/@href | //form/@action | //@data-product | //@data-image'):
        if not link.startswith('/') or link.startswith('//'): continue
        assert link.startswith(base+'/'), f'Unprefixed link: {path}: {link}'
        local = unquote(urlsplit(link).path[len(base):]).lstrip('/')
        target = out/local
        assert target.is_file() or (target/'index.html').is_file(), f'Missing target: {path}: {link}'
        count += 1
    for element in tree.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " product-stock ")]'):
        assert element.text_content().strip() == 'Наличие уточняется', f'Unconfirmed stock: {path}'
    assert not tree.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," sale-label ")]'), f'Unconfirmed sale: {path}'
print(f'PASS: {len(source)} products with unchanged non-price data and verified prices; {count} prepared links; honest availability')
