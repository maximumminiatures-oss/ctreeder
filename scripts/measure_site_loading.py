from pathlib import Path
import json,sys,time
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
out=Path(__import__('os').environ.get('SD_MEASUREMENT_OUTPUT',str(Path.cwd()/'browser-checks'/'delivery')));out.mkdir(parents=True,exist_ok=True);label=sys.argv[1];url=sys.argv[2] if len(sys.argv)>2 else 'https://ctreeder.com/site/';force_h1='--h1' in sys.argv;samples=3;warm_only='--warm-only' in sys.argv
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Users/Dungeon Master/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',headless=True,args=['--disable-http2'] if force_h1 else [])
 for sample in range(samples):
  ctx=browser.new_context(viewport={'width':1440,'height':1000});page=ctx.new_page();cdp=ctx.new_cdp_session(page);cdp.send('Network.enable');cdp.send('Network.emulateNetworkConditions',{'offline':False,'latency':150,'downloadThroughput':200000,'uploadThroughput':93750})
  page.add_init_script('performance.setResourceTimingBufferSize(5000); Math.random=()=>.61;')
  errors=[];failed=[];responses=[];extra=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:failed.append({'url':r.url,'error':r.failure}))
  cdp.on('Network.responseReceived',lambda e:responses.append({'url':e['response']['url'],'protocol':e['response']['protocol'],'status':e['response']['status'],'diskCache':e['response'].get('fromDiskCache',False)}))
  cdp.on('Network.responseReceivedExtraInfo',lambda e:extra.append(e['statusCode']))
  prime_status=None
  if warm_only:
   cdp.send('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
   page.goto(url,wait_until='domcontentloaded',timeout=120000);page.wait_for_load_state('networkidle',timeout=120000)
   prime_status=page.locator('#status-text').inner_text()
   if 'Generated' not in prime_status:raise RuntimeError('Cache prime did not successfully initialize the game: '+prime_status)
   cdp.send('Network.emulateNetworkConditions',{'offline':False,'latency':150,'downloadThroughput':200000,'uploadThroughput':93750})
  for warm in ([True] if warm_only else [False,True]):
   responses.clear();extra.clear();errors.clear();failed.clear();began=time.perf_counter()
   response=page.reload(wait_until='domcontentloaded',timeout=120000) if warm else page.goto(url,wait_until='domcontentloaded',timeout=120000)
   page.wait_for_selector('#status-text',state='attached',timeout=30000)
   page.wait_for_load_state('networkidle',timeout=120000)
   data=page.evaluate("""()=>({navigation:performance.getEntriesByType('navigation')[0].toJSON(),resources:performance.getEntriesByType('resource').map(e=>({name:e.name,start:e.startTime,end:e.responseEnd,bytes:e.transferSize,encoded:e.encodedBodySize,protocol:e.nextHopProtocol})),status:document.querySelector('#status-text').textContent,artwork:document.querySelector('#artwork-loading-text')?.textContent||null})""")
   resources=data['resources'];floor=[e for e in resources if 'room_grid_back' in e['name']]
   row={'label':label,'sample':sample+1,'warm':warm,'warmPrime':'successful-unthrottled-load' if warm_only else 'cold-at-test-speed','primeStatus':prime_status,'forceH1':force_h1,'url':url,'httpStatus':response.status,'settledMs':(time.perf_counter()-began)*1000,'domReadyMs':data['navigation']['domContentLoadedEventEnd'],
    'floorReadyMs':max([e['end'] for e in floor],default=None),'resourceEntries':len(resources),'transferBytes':sum(e['bytes'] for e in resources),'transferBytesScope':'resource entries only; excludes main HTML and canceled partial bytes','navigationTransferBytes':data['navigation'].get('transferSize'),'networkResponses':len(extra),'notModified':extra.count(304),
    'protocols':sorted(set(r['protocol'] for r in responses if urlsplit(r['url']).netloc==urlsplit(url).netloc)),'diskCacheResponses':sum(r['diskCache'] for r in responses),'errors':errors[:],'failed':failed[:],'status':data['status'],'artwork':data['artwork'],'resources':resources}
   results.append(row);(out/(label+'-loading.json')).write_text(json.dumps(results,indent=2),encoding='utf-8')
   print(json.dumps({k:v for k,v in row.items() if k not in ['resources','errors','failed']}),flush=True)
  ctx.close()
 browser.close()
