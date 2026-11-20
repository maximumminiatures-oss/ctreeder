"""Loopback-only delivery comparison; same gzip/headers for both input trees."""
import argparse,gzip,hashlib,json,mimetypes,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlsplit,parse_qs,unquote
from urllib.request import Request,urlopen
from urllib.error import HTTPError
class DeliveryHandler(BaseHTTPRequestHandler):
 source=None;output=None;proxy='http://127.0.0.1:5057';requests=[]
 def log_message(self,*args):pass
 def do_HEAD(self):self.respond(head=True)
 def do_GET(self):self.respond()
 def respond(self,head=False):
  url=urlsplit(self.path);self.requests.append(url.path)
  if not url.path.startswith('/site/'):
   try:
    req=Request(self.proxy+self.path,headers={'Cookie':self.headers.get('Cookie','')},method='HEAD' if head else 'GET')
    with urlopen(req,timeout=30) as response:
     data=response.read();self.send_response(response.status)
     for key in ['Content-Type','Set-Cookie']:
      if response.headers.get(key):self.send_header(key,response.headers[key])
     self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers()
     if not head:self.wfile.write(data)
   except HTTPError as error:self.send_error(error.code)
   return
  path=unquote(url.path[len('/site/'):]);immutable=path.startswith(('_releases/','_assets/'))
  root=self.output if immutable else self.source
  if path=='':
   root=self.source if parse_qs(url.query).get('delivery')==['raw'] else self.output
   path='index.html'
  candidate=(root/path).resolve()
  if not candidate.is_relative_to(root.resolve()) or any(part.startswith('.') for part in Path(path).parts):self.send_error(403);return
  if not candidate.is_file():self.send_error(404);return
  data=candidate.read_bytes();mime=mimetypes.guess_type(candidate.name)[0] or 'application/octet-stream'
  compressed=candidate.suffix.lower() in {'.js','.mjs','.css','.json','.html','.svg'} and 'gzip' in self.headers.get('Accept-Encoding','')
  etag='"'+hashlib.sha256(data).hexdigest()+('-gzip' if compressed else '')+'"'
  entry=path=='index.html';policy='public, max-age=31536000, immutable' if immutable else 'no-store' if entry else 'no-cache'
  if not entry and self.headers.get('If-None-Match')==etag:
   self.send_response(304);self.send_header('ETag',etag);self.send_header('Cache-Control',policy);self.end_headers();return
  if compressed:data=gzip.compress(data)
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control',policy);self.send_header('ETag',etag)
  self.send_header('X-Content-Type-Options','nosniff');self.send_header('Vary','Accept-Encoding')
  if compressed:self.send_header('Content-Encoding','gzip')
  self.send_header('Content-Length',str(len(data)));self.end_headers()
  if not head:self.wfile.write(data)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--port',type=int,default=5190);a=p.parse_args()
 DeliveryHandler.source=a.source.resolve();DeliveryHandler.output=a.output.resolve()
 print(json.dumps({'url':f'http://127.0.0.1:{a.port}/site/'}),flush=True)
 ThreadingHTTPServer(('127.0.0.1',a.port),DeliveryHandler).serve_forever()
