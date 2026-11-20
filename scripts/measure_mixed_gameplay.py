from pathlib import Path
from urllib.parse import urlsplit
import argparse
import json,sys,time
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description='Controlled solo movement/combat/save/load replay; synthetic fixture only.')
parser.add_argument('phase');parser.add_argument('--moves',type=int,default=3000);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--url',default='http://127.0.0.1:5057/site/');parser.add_argument('--build-root',type=Path)
args=parser.parse_args();root=Path(__file__).resolve().parents[1];out=args.output.resolve();out.mkdir(parents=True,exist_ok=True);phase=args.phase;moves=args.moves
instrument=(root/'scripts/performance/driver.js').read_text(encoding='utf-8').replace('for(let i=0;i<n;i++){','for(let i=0;i<n;i++){while(localWaterMotions.size)await longFrame();')
instrument+=(root/'scripts/performance/mixed.js').read_text(encoding='utf-8')
instrument+='\nwindow.__capturePrivateVisibility=()=>serializeSharedViewerVisibility();'
with sync_playwright() as p:
 browser=p.firefox.launch(executable_path='C:/Users/Dungeon Master/AppData/Local/ms-playwright/firefox-1532/firefox/firefox.exe',headless=True)
 ctx=browser.new_context(viewport={'width':1440,'height':1000});page=ctx.new_page();errors=[];page.add_init_script('Math.random=()=>.61;');page.on('pageerror',lambda e:errors.append(str(e)))
 def script_route(route):
  path=urlsplit(route.request.url).path
  source=args.build_root/path[len('/site/'):] if '/_releases/' in path and args.build_root else root/'S3_content/src/main.js'
  route.fulfill(body=source.read_text(encoding='utf-8')+'\n'+instrument,content_type='text/javascript')
 page.route('**/src/main.js*',script_route)
 page.goto(args.url,wait_until='domcontentloaded');page.wait_for_function('()=>window.__mixed?.ready()',timeout=120000)
 setup=page.evaluate('()=>__mixed.setup()');result={'phase':phase,'setup':setup,'samples':[],'combats':[],'reloads':[],'sheets':[],'errors':errors}
 (out/(phase+'-start-session.json')).write_text(json.dumps(page.evaluate('()=>__long.captureSession()')),encoding='utf-8')
 # An untimed combat first validates the driver; restore the pre-combat session afterward.
 session=page.evaluate('()=>__long.captureSession()');page.evaluate('()=>__mixed.startCombat()')
 for _ in range(4):page.evaluate('()=>__mixed.turn()')
 result['driverCheck']=page.evaluate('()=>__mixed.finishCombat()');page.evaluate('saved=>__long.restoreSession(saved)',session)
 for i in range(moves//100):
  step=page.evaluate('()=>__long.runChunk(100)');step['metrics']=page.evaluate('()=>__mixed.metrics()');result['samples'].append(step)
  if (i+1)%5==0:
   page.evaluate('()=>__mixed.startCombat()')
   for _ in range(20):page.evaluate('()=>__mixed.turn()')
   result['combats'].append(page.evaluate('()=>__mixed.finishCombat()'))
   result['reloads'].append(page.evaluate('()=>__mixed.saveReload()'));result['sheets'].append(page.evaluate('()=>__long.sheets()'))
  (out/(phase+'-progress.json')).write_text(json.dumps(result),encoding='utf-8')
  print(json.dumps({'phase':phase,'moves':step['snapshot']['moves'],'responseMs':step['response']['median'],'fogBytes':step['metrics']['fogBytes'],'combatTurns':sum(c['turns'] for c in result['combats'])}),flush=True)
 (out/(phase+'-final-world.json')).write_text(json.dumps(page.evaluate('()=>__long.captureWorld()')),encoding='utf-8');(out/(phase+'-private-visibility.json')).write_text(json.dumps(page.evaluate('()=>__capturePrivateVisibility()')),encoding='utf-8');result['physical']=page.evaluate('()=>__mixed.physical()');result['final']=page.evaluate('()=>__mixed.metrics()');page.screenshot(path=str(out/(phase+'-gameplay.png')))
 (out/(phase+'-mixed.json')).write_text(json.dumps(result,indent=2),encoding='utf-8');assert not errors,errors;browser.close()
