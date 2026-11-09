"""Fail deployment on missing files, broken prepared URLs or changed snapshot data."""
import hashlib
import json
import pathlib
import sys
from urllib.parse import unquote, urlsplit
from lxml import html

ROOT = pathlib.Path(__file__).resolve().parents[1]
base = sys.argv[1] if len(sys.argv) > 1 else '/steklofurnitura'
out = ROOT / (sys.argv[2] if len(sys.argv) > 2 else '.github-pages')
for name in ['index.html', 'catalog.html', 'search.html', 'system/cart.html', 'contacts.html',
             'app.js', 'style.css', 'products.json', '.nojekyll', '404.html']:
    assert (out / name).is_file(), f'Missing required output: {name}'
source = json.loads((ROOT/'dist/products.json').read_text())
canonical = [{k:v for k,v in p.items() if k != 'route'} for p in source]
digest = hashlib.sha256(json.dumps(canonical,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
assert digest == (ROOT/'research/catalog-baseline.sha256').read_text().strip(), 'Catalogue data changed: review snapshot before updating baseline'
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
print(f'PASS: {len(source)} unchanged products; {count} prepared links; honest availability')
