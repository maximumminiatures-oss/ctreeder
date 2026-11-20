from pathlib import Path
import argparse,base64,importlib.util,json,tempfile,threading
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
build=module('versioned_builder',ROOT/'scripts/build_versioned_site.py');preview=module('versioned_preview',ROOT/'scripts/preview_versioned_site.py')
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='sd-cache-check-') as tmp:
 root=Path(tmp);source=root/'source';output=root/'built';source.mkdir();(source/'src').mkdir();(source/'data').mkdir();(source/'assets').mkdir()
 (source/'index.html').write_text('<!doctype html><html><head><script type="module" src="./src/main.js"></script></head><body></body></html>')
 (source/'src/main.js').write_text("import {value} from './rules.js'; window.readVersion=async()=>({version:(await(await fetch('./data/rules.json')).json()).version,value}); window.ready=readVersion(); const img=new Image(); img.src='./assets/pixel.png'; document.body.append(img);")
 (source/'src/rules.js').write_text('export const value="same rules module";')
 (source/'assets/pixel.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII='))
 (source/'data/rules.json').write_text('{"version":1}');old=build.build_release(source,output,activate=True)
 class Handler(preview.DeliveryHandler):
  source=source;output=output
  def respond(self,head=False):
   if self.path=='/api/session':
    body=b'{"authenticated":false}';self.send_response(200);self.send_header('Cache-Control','no-store');self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
   super().respond(head)
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}/site/'
 try:
  with sync_playwright() as play:
   browser=play.chromium.launch(executable_path='C:/Users/Dungeon Master/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',headless=True)
   ctx=browser.new_context();first=ctx.new_page();errors=[];first.on('pageerror',lambda e:errors.append(str(e)))
   first.goto(url);before=first.evaluate('()=>window.ready');assert before['version']==1
   first.evaluate("history.replaceState(null,'','/site/?room=fixture')");assert first.evaluate('()=>readVersion()')['version']==1
   (source/'data/rules.json').write_text('{"version":2}');new=build.build_release(source,output,activate=True)
   assert old['artwork']==new['artwork'];assert first.evaluate('()=>readVersion()')['version']==1
   second=ctx.new_page();second.goto(url);assert second.evaluate('()=>window.ready')['version']==2
   uri=f"http://127.0.0.1:{server.server_port}/site/_releases/{old['release']}/data/rules.json";response=ctx.request.get(uri);assert response.json()['version']==1;assert 'immutable' in response.headers['cache-control']
   private=ctx.request.get(f'http://127.0.0.1:{server.server_port}/api/session');assert private.headers['cache-control']=='no-store'
   build.activate_release(output,old['release']);third=ctx.new_page();third.goto(url);assert third.evaluate('()=>window.ready')['version']==1
   assert not errors,errors
   result={'oldTabRetainsOldRules':True,'newTabGetsNewRules':True,'historyNavigationKeepsPinnedData':True,'rollbackWorks':True,'unchangedArtworkReused':True,'privateResponseNoStore':True,'errors':errors,'old':old,'new':new}
   (a.output/'cache-coherence.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result));browser.close()
 finally:server.shutdown();server.server_close()
 assert root.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve())
