"""Download source assets, optimize raster images, retain original documents."""
import concurrent.futures,hashlib,io,json,pathlib,time,urllib.request,urllib.parse
from PIL import Image,ImageOps

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/media';OUT.mkdir(exist_ok=True)
mapping_file=ROOT/'research/media-map.json'
mapping=json.loads(mapping_file.read_text()) if mapping_file.exists() else {}
urls=json.loads((ROOT/'research/asset-urls.json').read_text())
external_file=ROOT/'research/external-documents.json'
external_documents=set(json.loads(external_file.read_text())) if external_file.exists() else set()

def run(u):
    if u in external_documents:return u,u,None
    if u in mapping and (ROOT/'dist'/mapping[u].lstrip('/')).exists():return u,mapping[u],None
    sha=hashlib.sha256(u.encode()).hexdigest()[:24]
    ext=pathlib.Path(urllib.parse.urlparse(u).path).suffix.lower()
    image=ext in ['.jpg','.jpeg','.png','.gif','.webp','.bmp']
    out=OUT/(sha+('.webp' if image else ext or '.bin'))
    if out.exists():return u,'/media/'+out.name,None
    for attempt in range(3):
        try:
            request=urllib.request.Request(urllib.parse.quote(u,safe=':/%?=&,+*()'),headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(request,timeout=35) as response:
                data=response.read()
                if 'text/html' in response.headers.get('Content-Type','') and ext!='.html':raise ValueError('HTML returned for asset')
            if image:
                im=ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
                im.thumbnail((1600,1600),Image.Resampling.LANCZOS)
                im.save(out,'WEBP',quality=84,method=4)
            else:out.write_bytes(data)
            return u,'/media/'+out.name,None
        except Exception as e:
            if attempt==2:return u,None,str(e)
            time.sleep(attempt+1)

if __name__=='__main__':
    errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        futures={pool.submit(run,u):u for u in urls}
        for n,future in enumerate(concurrent.futures.as_completed(futures),1):
            u,path,error=future.result()
            if error:errors.append({'url':u,'error':error})
            else:mapping[u]=path
            if n%100==0:
                mapping_file.write_text(json.dumps(mapping,ensure_ascii=False))
                print(n,'/',len(urls),'errors',len(errors),flush=True)
    mapping_file.write_text(json.dumps(mapping,ensure_ascii=False))
    (ROOT/'research/asset-errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2))
    print('DONE',len(mapping),'downloaded;',len(errors),'errors',flush=True)
