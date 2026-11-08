import pathlib,urllib.request,concurrent.futures
from lxml import html
B='https://www.steklofurnitura.by/'
root=pathlib.Path(__file__).parent
paths=['contacts.html','gallery.html','sitemap.xml','robots.txt','catalog/furnitura-dlya-dushevyix-kabin/','catalog/furnitura-dlya-dushevyix-kabin/stif-glass/sf-petli/sf-303-cp-petlya-steklo-steklo-180gr.html']
def f(p):
 try:
  data=urllib.request.urlopen(B+p,timeout=40).read();fn=root/(p.replace('/','__'));fn.write_bytes(data)
  print(p,len(data))
 except Exception as e:print(p,str(e))
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(f,paths))
t=html.parse(str(root/'home.html'))
def tree(e,depth=0):
 if depth>4 or not isinstance(e.tag,str) or e.tag in ['script','style']:return
 print(' '*depth,e.tag,e.get('class',''),e.get('id',''),(' '.join(e.text_content().split())[:80] if depth>2 else ''))
 for c in e:tree(c,depth+1)
tree(t.find('body'))
