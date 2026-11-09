"""Every rendered price must match the same complete official price manifest."""
import json,pathlib
from lxml import html
from sync_prices import validate_manifest,label
ROOT=pathlib.Path(__file__).resolve().parents[1]
products=json.loads((ROOT/'dist/products.json').read_text());manifest=json.loads((ROOT/'data/prices.json').read_text())
validate_manifest(manifest,products)
expected={p['url']:p for p in products};count=details=0
cls=lambda s:f'contains(concat(" ",normalize-space(@class)," ")," {s} ")'
for path in (ROOT/'dist').rglob('*.html'):
    doc=html.parse(str(path))
    for card in doc.xpath('//*['+cls('product-card')+']'):
        routes=card.xpath('.//button[@data-product]/@data-product')
        prices=card.xpath('.//*['+cls('product-price')+']')
        assert len(routes)==len(prices)==1, f'Malformed price card: {path}'
        assert prices[0].text_content().strip()==expected[routes[0]]['price'],f'Stale recommendation/catalogue price: {path}'
        count+=1
    detail=doc.xpath('//*['+cls('detail-price')+']')
    if detail:
        routes=doc.xpath('//*['+cls('order-actions')+']//button/@data-product')
        assert len(routes)==1 and len(detail)==1
        assert (detail[0].text or '').strip()==expected[routes[0]]['price'],f'Stale detail price: {path}'
        details+=1
    # Price-looking BYN text outside controlled components cannot silently survive.
    for node in doc.xpath('//main//*[not(self::script or self::style)]'):
        for value in (node.text,node.tail):
            if value and 'BYN' in value and any(c.isdigit() for c in value):
                assert node.xpath('ancestor-or-self::*['+cls('product-price')+' or '+cls('detail-price')+']'),f'Uncontrolled numeric price: {path}'
assert count>len(products) and details==len(products), 'Incomplete rendered price coverage'
print(f'PASS: {count} catalogue/recommendation prices and {details} detail prices agree with official verification')
