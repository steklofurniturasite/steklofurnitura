import importlib.util, pathlib, sys, unittest, copy
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from sync_prices import parse_price, VerificationError, label, validate_manifest, Client, BASE, UA
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.robotparser import RobotFileParser

P={'url':'/catalog/test.html','article':'ABC-1'}
def page(price,article='ABC-1'):
    return f'<html><head><meta charset="utf-8"></head><div class="tovar-wrapper"><input name="article__1__add" value="{article}"><input name="linkP__1__add" value="{BASE}/catalog/test.html"><table><tr><th>Арт.:</th><td>{article}</td></tr>{price}</table></div></html>'.encode()
class PriceParser(unittest.TestCase):
    def parse(self,s):return parse_price(page(s),P,BASE+P['url'])
    def test_vat_and_current_only(self):
        r=self.parse('<tr><th>Цена c НДС:</th><td><s>99,00 BYN</s><span class="price-old">88,00 BYN</span><span style="text-decoration:line-through">77 BYN</span>12,34 BYN</td></tr>')
        self.assertEqual(r['amount_minor'],1234);self.assertEqual(label(r),'12,34 BYN')
    def test_space_thousands(self):self.assertEqual(self.parse('<tr><th>Цена с НДС:</th><td>1\u00a0234,50 BYN</td></tr>')['amount_minor'],123450)
    def test_explicit_request_wins_over_hidden_old_price(self):
        r=self.parse('<tr><th style="display:none">Цена с НДС:</th><td style="display:none">3,00 BYN</td></tr><tr><td>Цену уточняйте</td></tr>')
        self.assertEqual(r['status'],'request');self.assertIsNone(r['amount_minor'])
    def test_hidden_is_not_public_numeric(self):
        r=self.parse('<tr><th style="display:none">Цена с НДС:</th><td style="display: none">5,38 BYN</td></tr>')
        self.assertEqual(r['status'],'unavailable');self.assertEqual(label(r),'Цену уточняйте')
    def test_hidden_parent_and_old_descendant(self):
        self.assertEqual(self.parse('<tr hidden><td>77 BYN</td></tr>')['status'],'unavailable')
        with self.assertRaises(VerificationError):self.parse('<tr><th>Цена с НДС:</th><td><del>77 BYN</del></td></tr>')
    def test_missing_vat_and_ambiguous_and_wrong_currency(self):
        for s in ['<tr><th>Цена:</th><td>2 BYN</td></tr>','<tr><th>Цена с НДС:</th><td>2 BYN 3 BYN</td></tr>','<tr><th>Цена с НДС:</th><td>2 USD</td></tr>','<tr><th>Цена с НДС:</th><td>0 BYN</td></tr>','<tr><td>Нет в наличии</td></tr>']:
            with self.subTest(s=s),self.assertRaises(VerificationError):self.parse(s)
    def test_article_is_exact(self):
        for article in ['ABC-2','abc-1','ABC-1 ']:
            with self.subTest(article=article),self.assertRaises(VerificationError):parse_price(page('<tr><td>Цену уточняйте</td></tr>',article),P,BASE+P['url'])
    def test_wrong_redirect_or_access_page(self):
        with self.assertRaises(VerificationError):parse_price(page('<tr><td>Цену уточняйте</td></tr>'),P,BASE+'/catalog/other.html')
        with self.assertRaises(VerificationError):parse_price(b'<html>Access denied</html>',P,BASE+P['url'])
    def test_conflicting_states(self):
        with self.assertRaises(VerificationError):self.parse('<tr><th>Цена с НДС:</th><td>5 BYN</td></tr><tr><td>Цену уточняйте</td></tr>')
    def test_manifest_cannot_publish_unknown_number(self):
        r=dict(self.parse('<tr><td>Цену уточняйте</td></tr>'),article='ABC-1',source_url=BASE+P['url'],checked_at='2026-11-09T00:00:00+00:00',body_sha256='a'*64)
        m={'schema':1,'source':BASE,'complete':True,'started_at':'2026-11-09T00:00:00+00:00','completed_at':'2026-11-09T01:00:00+00:00','products':{P['url']:r}}
        validate_manifest(m,[P]);r['amount_minor']=123
        with self.assertRaises(VerificationError):validate_manifest(m,[P])
    def test_network_failure_never_returns_request_price(self):
        c=Client(.5,1);r=RobotFileParser();r.parse(['User-agent: *','Allow: /']);c.robot=r
        with patch('sync_prices.req.OpenerDirector.open',side_effect=URLError('offline')),patch('sync_prices.time.sleep'):
            with self.assertRaises(URLError):c.get(BASE+P['url'])
        self.assertEqual(c.requests,2);self.assertEqual(c.retry_count,1)
    def test_429_honors_retry_after(self):
        c=Client(.5,1);r=RobotFileParser();r.parse(['User-agent: *','Allow: /']);c.robot=r
        error=HTTPError(BASE+P['url'],429,'Slow down',{'Retry-After':'4'},None)
        with patch('sync_prices.req.OpenerDirector.open',side_effect=error),patch('sync_prices.time.sleep') as sleep:
            with self.assertRaises(HTTPError):c.get(BASE+P['url'])
        self.assertTrue(any(call.args[0]>=4 for call in sleep.call_args_list))
    def test_robots_denial_has_no_network_request(self):
        c=Client();r=RobotFileParser();r.parse(['User-agent: *','Disallow: /catalog/']);c.robot=r
        with patch('sync_prices.req.OpenerDirector.open') as open_:
            with self.assertRaises(VerificationError):c.get(BASE+P['url'])
            open_.assert_not_called()

class BatchSafety(unittest.TestCase):
    def test_failed_batch_keeps_previous_manifest(self):
        import tempfile,json,sync_prices
        class Offline:
            def __init__(self,*a):self.requests=0;self.retry_count=0
            def robots(self):return b'User-agent: *\nAllow: /'
            def get(self,*a):self.requests+=1;raise URLError('offline')
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/'dist').mkdir();(root/'data').mkdir()
            products=[{'url':f'/catalog/{i}.html','article':f'A{i}','price':'3,00 BYN'} for i in range(1463)]
            (root/'dist/products.json').write_text(json.dumps(products));manifest=root/'data/prices.json';manifest.write_text('{"previous":"untouched"}')
            work=root/'work'
            with patch.object(sync_prices,'ROOT',root),patch.object(sync_prices,'Client',Offline),patch.object(sync_prices,'validate_catalogue_identity'),patch.object(sys,'argv',['sync_prices.py','--apply','--work-dir',str(work)]),patch('builtins.print'):
                self.assertEqual(sync_prices.main(),1)
            self.assertEqual(manifest.read_text(),'{"previous":"untouched"}')
            summary=json.loads((work/'summary.json').read_text())
            self.assertEqual(summary['without_public_price'],0);self.assertEqual(summary['unverified'],1463);self.assertEqual(summary['errors'],3);self.assertFalse(summary['applied']);self.assertTrue((work/'products-before.json.gz').exists())
    def test_incomplete_scope_cannot_be_applied(self):
        from sync_prices import apply_prices
        p={'/catalog/test.html':dict(P,price='9,00 BYN')}
        with self.assertRaises(VerificationError):apply_prices(p,{'schema':1,'source':BASE,'complete':True,'started_at':'2026-11-09T00:00:00+00:00','completed_at':'2026-11-09T01:00:00+00:00','products':{}})
        self.assertEqual(p[P['url']]['price'],'9,00 BYN')

class RedirectSafety(unittest.TestCase):
    def test_block_offsite_insecure_and_forbidden_redirects(self):
        from sync_prices import SafeRedirect,req
        c=Client();r=RobotFileParser();r.parse(['User-agent: *','Disallow: /manager/']);c.robot=r
        handler=SafeRedirect(c)
        for url in ['https://example.com/catalog/test.html','http://www.steklofurnitura.by/catalog/test.html',BASE+'/manager/']:
            with self.subTest(url=url),self.assertRaises(VerificationError):handler.redirect_request(req.Request(BASE+P['url']),None,302,'',{},url)
if __name__=='__main__':unittest.main()
