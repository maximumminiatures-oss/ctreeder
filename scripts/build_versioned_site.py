"""Immutable ShadowSpawner static releases; no runtime/bundling dependencies."""
from __future__ import annotations
import argparse,hashlib,json,os,re,shutil,tempfile
from pathlib import Path,PurePosixPath

FORMAT=1
ROOT_FILES={'index.html','about.html','traps.json','Tagesschrift-OFL.txt'}
STATIC_DIRS={'src':{'.js','.mjs'},'data':{'.json'},'spells':{'.json'},'assets':{'.png','.jpg','.jpeg','.svg','.webp','.gif','.ico'}}
ROOT_EXTENSIONS={'.css','.ttf','.woff','.woff2','.ico'}
IMPORT=re.compile(r'(?:^|\n)\s*(?:import|export)\s+(?:[\w*$,\s{}]+\s+from\s+)?[\'"](\.[^\'"\n]+)[\'"]')
DYNAMIC_IMPORT=re.compile(r'\bimport\(\s*[\'"](\.[^\'"\n]+)[\'"]')
def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
def mount_path(value):
 if not re.fullmatch(r'/[a-zA-Z0-9_/-]+/',value) or '..' in value or '//' in value:raise ValueError('Mount must be a clean absolute directory URL, e.g. /site/.')
 return value

def public_files(source):
 files=[]
 for p in sorted(source.rglob('*')):
  relative=p.relative_to(source);parts=relative.parts
  if p.is_symlink():raise ValueError(f'Symlinks are not allowed in the public source: {relative}')
  if not p.is_file():continue
  if any(part.startswith('.') or part.lower() in {'unused-assets','old assets','private','saves','backups'} for part in parts):continue
  allowed=len(parts)==1 and (p.name in ROOT_FILES or p.suffix.lower() in ROOT_EXTENSIONS or re.fullmatch(r'monsters-\d+\.json',p.name))
  if len(parts)>1:allowed=parts[0] in STATIC_DIRS and p.suffix.lower() in STATIC_DIRS[parts[0]]
  if allowed:files.append((relative.as_posix(),p.read_bytes()))
 if 'index.html' not in dict(files):raise ValueError('Public index.html is required.')
 return files

def validate_graph(files):
 available=set(dict(files))
 for name,data in files:
  if name.startswith('src/') and name.endswith(('.js','.mjs')):
   text=data.decode('utf-8-sig')
   for ref in IMPORT.findall(text)+DYNAMIC_IMPORT.findall(text):
    path=ref.split('?',1)[0].split('#',1)[0]
    parts=list(PurePosixPath(name).parent.parts)
    for part in PurePosixPath(path).parts:
     if part=='..':
      if not parts:raise ValueError(f'Import escapes release: {name}: {ref}')
      parts.pop()
     elif part!='.':parts.append(part)
    if '/'.join(parts) not in available:raise ValueError(f'Missing release import: {name}: {ref}')
   if re.search(r'[\'"]/site/(?:src|data|spells)/',text):raise ValueError(f'Absolute static reference bypasses release base: {name}')

def rewrite_art_urls(text,mount,asset_id,fonts):
 base=mount+'_assets/'+asset_id+'/'
 pattern=re.compile(r"(['\"`])(?:\./|\.\./|"+re.escape(mount)+r")assets(?=/|['\"`])")
 text=pattern.sub(lambda m:m.group(1)+base+'assets',text)
 for font in fonts:
  pattern=re.compile(r"(['\"])(?:\./|\.\./)?"+re.escape(font)+r"(?=['\"])")
  text=pattern.sub(lambda m:m.group(1)+base+font,text)
 return text

def publish_art(output,asset_id,files):
 root=output/'_assets'
 if root.is_symlink():raise ValueError('Artwork directory cannot be a symlink.')
 root.mkdir(exist_ok=True);root.chmod(0o755);destination=root/asset_id
 if destination.exists():
  actual={p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file()}
  if actual!=set(files):raise ValueError('Immutable artwork inventory changed.')
  for name,data in files.items():
   path=destination/name
   if path.is_symlink() or not path.resolve().is_relative_to(destination.resolve()) or path.read_bytes()!=data:raise ValueError('Immutable artwork integrity failure.')
  return
 stage=Path(tempfile.mkdtemp(prefix='.stage-',dir=root));assert stage.resolve().is_relative_to(root.resolve())
 try:
  for name,data in files.items():
   path=stage/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);path.chmod(0o644)
  for folder in stage.rglob('*'):
   if folder.is_dir():folder.chmod(0o755)
  stage.chmod(0o755);os.rename(stage,destination)
 finally:
  if stage.exists():
   assert stage.resolve().is_relative_to(root.resolve()) and stage.name.startswith('.stage-')
   shutil.rmtree(stage)

def atomic_write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(prefix=path.name+'.',suffix='.tmp',dir=path.parent)
 temp=Path(name)
 assert temp.resolve().is_relative_to(path.parent.resolve())
 try:
  with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
  os.chmod(temp,0o644);os.replace(temp,path)
 finally:
  if temp.exists():temp.unlink()

def verify_release(output,release):
 if not re.fullmatch(r'[0-9a-f]{24}',release):raise ValueError('Invalid release ID.')
 folder=output.resolve()/'_releases'/release
 if not folder.resolve().is_relative_to(output.resolve()):raise ValueError('Release escapes output directory.')
 manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
 if manifest['release']!=release or manifest['format']!=FORMAT:raise ValueError('Release manifest identity mismatch.')
 mount_path(manifest['mount'])
 expected=set(manifest['files'])|{'manifest.json'}
 actual={p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()}
 if actual!=expected:raise ValueError('Release inventory does not match its manifest.')
 for relative,info in manifest['files'].items():
  path=folder/relative
  if not path.resolve().is_relative_to(folder.resolve()) or path.is_symlink():raise ValueError('Unsafe release path.')
  data=path.read_bytes()
  if len(data)!=info['bytes'] or sha(data)!=info['sha256']:raise ValueError(f'Release integrity failure: {relative}')
 artwork=manifest.get('artwork')
 if artwork:
  art_root=output.resolve()/'_assets'/artwork['id']
  if not re.fullmatch(r'[0-9a-f]{24}',artwork['id']) or not art_root.resolve().is_relative_to(output.resolve()):raise ValueError('Invalid artwork release.')
  for name,info in artwork['files'].items():
   path=art_root/name
   if not path.resolve().is_relative_to(art_root.resolve()) or path.is_symlink() or sha(path.read_bytes())!=info['sha256']:raise ValueError('Artwork integrity failure.')
 return manifest

def activate_release(output,release):
 manifest=verify_release(output,release)
 atomic_write(output/'index.html',(output/'_releases'/release/'index.html').read_bytes())
 atomic_write(output/'release.json',canonical({'release':release,'manifest':manifest['mount']+'_releases/'+release+'/manifest.json'}))
 return manifest

def build_release(source,output,mount='/site/',activate=False):
 source=source.resolve();output=output.resolve();mount=mount_path(mount)
 if source==output or output.is_relative_to(source) or source.is_relative_to(output):raise ValueError('Source and output directories must be separate.')
 files=public_files(source);validate_graph(files)
 inputs={name:{'sha256':sha(data),'bytes':len(data)} for name,data in files}
 if public_files(source)!=files:raise ValueError('Source changed during build; retry from a stable snapshot.')
 release=sha(canonical({'format':FORMAT,'recipe':'shared-art-v1','mount':mount,'inputs':inputs}))[:24]
 art={name:data for name,data in files if name.startswith('assets/') or Path(name).suffix.lower() in {'.ttf','.woff','.woff2','.ico'}}
 art_info={name:inputs[name] for name in art}
 asset_id=sha(canonical(art_info))[:24];fonts=[name for name in art if '/' not in name]
 payload={name:(rewrite_art_urls(data.decode('utf-8-sig'),mount,asset_id,fonts).encode() if Path(name).suffix.lower() in {'.js','.mjs','.css','.html'} else data) for name,data in files}
 html=payload['index.html'].decode('utf-8-sig')
 if re.search(r'<base\b',html,re.I):raise ValueError('Source already has a base element; review release URL handling.')
 base=f'<base href="{mount}_releases/{release}/" data-sd-release="{release}" />'
 html,count=re.subn(r'(<head(?:\s[^>]*)?>)',lambda m:m.group(1)+'\n    '+base,html,count=1,flags=re.I)
 if count!=1:raise ValueError('Expected one HTML head element.')
 payload['index.html']=html.encode()
 manifest={'format':FORMAT,'release':release,'mount':mount,'artwork':{'id':asset_id,'files':art_info},'inputs':inputs,'files':{name:{'sha256':sha(data),'bytes':len(data)} for name,data in payload.items()}}
 if output.exists() and any(p.name not in {'_releases','_assets','index.html','release.json'} for p in output.iterdir()):raise ValueError('Output must be a dedicated frontend build directory.')
 releases=output/'_releases'
 if releases.is_symlink():raise ValueError('Release directory cannot be a symlink.')
 releases.mkdir(parents=True,exist_ok=True);output.chmod(0o755);releases.chmod(0o755)
 publish_art(output,asset_id,art)
 destination=releases/release
 if destination.exists():
  existing=verify_release(output,release)
  if existing!=manifest:raise ValueError('Existing immutable release differs; refusing overwrite.')
 else:
  staging=Path(tempfile.mkdtemp(prefix='.stage-',dir=releases))
  assert staging.resolve().is_relative_to(releases.resolve())
  try:
   for name,data in payload.items():
    path=staging/name;path.parent.mkdir(parents=True,exist_ok=True)
    if name in art:
     try:os.link(output/'_assets'/asset_id/name,path)
     except OSError:path.write_bytes(data)
    else:path.write_bytes(data)
    path.chmod(0o644)
   (staging/'manifest.json').write_bytes(canonical(manifest));(staging/'manifest.json').chmod(0o644)
   for folder in staging.rglob('*'):
    if folder.is_dir():folder.chmod(0o755)
   staging.chmod(0o755)
   os.rename(staging,destination)
  finally:
   if staging.exists():
    assert staging.resolve().is_relative_to(releases.resolve()) and staging.name.startswith('.stage-')
    shutil.rmtree(staging)
  verify_release(output,release)
 if activate:activate_release(output,release)
 return {'release':release,'files':len(payload),'bytes':sum(map(len,payload.values())),'sourceBytes':sum(len(data) for _,data in files),'activated':activate,'mount':mount,'artwork':asset_id}

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source',type=Path,default=Path('S3_content'));parser.add_argument('--output',type=Path,default=Path('.frontend-build'))
 parser.add_argument('--mount',default='/site/');parser.add_argument('--activate',action='store_true');parser.add_argument('--activate-release');parser.add_argument('--verify')
 args=parser.parse_args()
 if args.verify:result=verify_release(args.output,args.verify);result={'release':result['release'],'verified':True,'files':len(result['files'])}
 elif args.activate_release:result=activate_release(args.output,args.activate_release);result={'release':result['release'],'activated':True}
 else:result=build_release(args.source,args.output,args.mount,args.activate)
 print(json.dumps(result))
if __name__=='__main__':main()
