"""Actual Chromium → DSH Connection/Gateway → Bun → public native catalog candidate."""
import asyncio,json,math,time,os,platform
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    output=Path('vendor/catalog-browser'); output.mkdir(parents=True,exist_ok=True)
    result={'kind':'actual-synthetic-native-catalog-through-DSH-Remote','platform':platform.platform(),'cases':[],
        'hardware':{'cpus':os.cpu_count(),'memoryKiB':int(Path('/proc/meminfo').read_text().splitlines()[0].split()[1])},
        'limits':'Linux fixture; no real profile/global installation/provider/model; Windows deferred; timings are this environment, not formal reference hardware S5 acceptance'}
    host_pid=next(int(item.name) for item in Path('/proc').iterdir() if item.name.isdigit()
        and (item/'cmdline').exists() and b'vendor/host-catalog/catalog-fixture-main.js' in (item/'cmdline').read_bytes().split(b'\0')
        and os.path.realpath(item/'cwd')==str(Path.cwd()))
    rss=[];sampling=True
    async def sample_rss():
        while sampling:
            status=Path(f'/proc/{host_pid}/status').read_text()
            rss.append(int(next(line for line in status.splitlines() if line.startswith('VmRSS:')).split()[1]))
            await asyncio.sleep(.025)
    sampler=asyncio.create_task(sample_rss())
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        result['browser']=browser.version
        page=await browser.new_page(); errors=[]; calls=[]; mux=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda req:calls.append(req) if '/api/ompCatalogFixture/' in req.url else None)
        page.on('websocket',lambda ws:ws.on('framesent',lambda frame:mux.append(frame)))
        started=time.perf_counter(); await page.goto('http://127.0.0.1:3181/')
        await page.locator('#catalog[data-status="partial"]').wait_for(timeout=30000)
        result['firstColdScreenMs']=(time.perf_counter()-started)*1000
        assert 'Synthetic native data only' in await page.locator('body').inner_text()
        assert 'INVALID_SOURCE' in await page.locator('#catalog').inner_text()
        assert 'INVALID_METADATA' in await page.locator('#catalog').inner_text()
        ids=[]; rows=0; older=[]
        while True:
            articles=page.locator('article'); ids.extend(await articles.evaluate_all('(rows)=>rows.map(row=>row.dataset.nativeId)'))
            rows+=await articles.count()
            if await page.locator('#next').is_disabled():break
            started=time.perf_counter(); await page.locator('#next').click()
            await page.locator('#catalog[data-status="partial"]').wait_for()
            older.append((time.perf_counter()-started)*1000)
        assert rows==1002,(rows,errors)
        assert set(ids)=={f'native-{n:04d}' for n in range(1000)}|{'unknown-cwd'}
        assert ids.count('native-0000')==2
        result['cases'].append({'name':'all-1000-distinct-bucket-native-sessions-and-custom-copy-reachable','result':'PASS','rows':rows})
        await page.locator('article button').first.click()
        await page.locator('#detail').get_by_text('verified',exact=True).wait_for()
        result['cases'].append({'name':'actual-native-description-and-observation','result':'PASS'})
        await page.screenshot(path=str(output/'catalog.png'),full_page=True)
        samples=[];old_samples=[]
        for index in range(32):
            started=time.perf_counter(); await page.locator('#refresh').click()
            await page.locator('#catalog[data-status="partial"]').wait_for(timeout=30000)
            elapsed=(time.perf_counter()-started)*1000
            if index>=2:samples.append(elapsed)
            started=time.perf_counter();await page.locator('#next').click()
            await page.locator('#catalog[data-status="partial"]').wait_for()
            if index>=2:old_samples.append((time.perf_counter()-started)*1000)
        def stats(samples):return {'samplesMs':samples,'p95Ms':sorted(samples)[math.ceil(.95*len(samples))-1],'maximumMs':max(samples)}
        result['firstUsableCatalog']=stats(samples)
        result['oldPages']=stats(old_samples);result['fullTraversalOldPagesMs']=older
        assert result['firstUsableCatalog']['p95Ms']<=3000
        assert result['oldPages']['p95Ms']<=1000
        envelopes=[req.post_data_json for req in calls]
        assert all(call['method'] in ['ompCatalogFixture/page','ompCatalogFixture/sources','ompCatalogFixture/describe'] for call in envelopes)
        assert any(isinstance(frame,str) and json.loads(frame).get('endpoint')=='$events' for frame in mux)
        result['DSHRemoteCalls']=len(envelopes); result['pageErrors']=errors; assert not errors,errors
        result['cases'].append({'name':'genuine-DSH-Connection-Remote-and-events-mux','result':'PASS'})
        # Explicit carrier failure fixture, separate from all actual native assertions above.
        await page.route('**/api/ompCatalogFixture/page',lambda route:route.fulfill(json={
            'type':'server-response','rpcId':'wrong-id','result':{'ok':True,'value':{'status':'error','code':'CATALOG_STALE'}}}))
        await page.locator('#refresh').click();await page.get_by_text('catalog_request_failed; restart discovery',exact=True).wait_for()
        result['cases'].append({'name':'labelled-wrong-correlation-carrier-fault','result':'PASS'})
        response=await page.request.get('http://127.0.0.1:3181/api/sessions');assert response.status==501
        result['cases'].append({'name':'product-private-session-api-still-blocked','result':'PASS'})
        await browser.close()
    sampling=False;await sampler
    status=Path(f'/proc/{host_pid}/status').read_text()
    high_water=int(next(line for line in status.splitlines() if line.startswith('VmHWM:')).split()[1])
    result['hostMemory']={'sampleIntervalMs':25,'sampledPeakRssKiB':max(rss),'osHighWaterRssKiB':high_water}
    assert max(max(rss),high_water)<=512*1024
    result['otherProcessCosts']='OMP/browser/tool peaks not measured here; full-machine/reference-hardware matrix remains S5'
    (output/'browser.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
asyncio.run(main())
