"""Copy the static site and adapt local URLs for a GitHub Pages project path."""
import argparse
from pathlib import Path
import re
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-path', default='/steklofurnitura')
parser.add_argument('--output', default='.github-pages')
args = parser.parse_args()
base = '/' + args.base_path.strip('/') if args.base_path.strip('/') else ''
root = Path(__file__).resolve().parents[1]
source = root / 'dist'
out = (root / args.output).resolve()
if out == root or root not in out.parents or out == source or source in out.parents:
    raise SystemExit('Output must be a separate directory inside the checkout')
if out.exists():
    shutil.rmtree(out)
shutil.copytree(source, out)
for path in out.rglob('*'):
    if path.suffix not in {'.html', '.css', '.js', '.json'}:
        continue
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'''(["'`])/(?!/)''', lambda m: m[1] + base + '/', text)
    if path.suffix == '.css':
        text = re.sub(r'url\(/(?!/)', lambda m: 'url(' + base + '/', text)
    path.write_text(text, encoding='utf-8')
(out / '.nojekyll').touch()
shutil.copyfile(out / 'system/404.html', out / '404.html')
print(f'Prepared {sum(p.is_file() for p in out.rglob("*"))} files at {out}')
