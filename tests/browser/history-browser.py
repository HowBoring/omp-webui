"""Actual Linux Chromium → DSH typed Remote → Bun → public native RPC, isolated data only."""
import asyncio
import json
import hashlib
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    evidence=Path('vendor/history-browser-evidence'); evidence.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        responses=[]
        page.on('response',lambda response: responses.append(response))
        await page.goto('http://127.0.0.1:3184')
        await page.wait_for_function("document.querySelector('#state').textContent.includes('readable records')")
        for _ in range(10):
            if await page.locator('#more').is_disabled(): break
            await page.locator('#more').click()
            await page.wait_for_function("!document.querySelector('#more').disabled || document.querySelector('#state').textContent.includes('complete')")
        assert 'complete' in await page.locator('#state').inner_text()
        active=await page.locator('#history').inner_text()
        assert 'After native reset' in active and 'Abandoned branch' not in active and 'Background branch' not in active
        assert 'SYNTHETIC_PRIVATE_TOKEN' not in active
        assert await page.locator('#history details').count() >= 2
        assert not await page.get_by_text('Before native compaction',exact=True).is_visible()
        for details in await page.locator('#history details').all():
            await details.locator(':scope > summary').click()
        assert await page.get_by_text('Before native compaction',exact=True).is_visible()
        await page.get_by_role('button',name='Preview retained image/png',exact=False).click()
        await page.wait_for_function("document.querySelector('#history img')?.naturalWidth === 1")
        await page.locator('#scope').select_option('tree')
        await page.wait_for_function("document.querySelector('#state').textContent.includes('128 readable records')")
        for _ in range(10):
            if await page.locator('#more').is_disabled(): break
            await page.locator('#more').click()
            await page.wait_for_function("!document.querySelector('#more').disabled || document.querySelector('#state').textContent.includes('complete')")
        tree=await page.locator('#history').inner_text()
        assert 'Abandoned branch' in tree and 'Background branch' in tree
        assert 'SYNTHETIC_PRIVATE_TOKEN' not in tree
        await page.locator('#scope').select_option('running')
        await page.wait_for_function("document.querySelector('#state').textContent.includes('128 readable records')")
        for _ in range(10):
            if await page.locator('#more').is_disabled(): break
            await page.locator('#more').click()
            await page.wait_for_function("!document.querySelector('#more').disabled || document.querySelector('#state').textContent.includes('complete')")
        running=await page.locator('#history').inner_text()
        assert 'After native reset' in running and 'Before native compaction' not in running
        assert 'Abandoned branch' not in running and 'Background branch' not in running
        calls=[await r.json() for r in responses if r.url.endswith('/api/ompHistoryFixture/read')]
        successful=[call['result']['value'] for call in calls if call['result']['ok']]
        opened=[call['value'] for call in successful if call['status']=='opened']
        pages=[call['value'] for call in successful if call['status']=='page']
        assert opened and len(pages)>=4
        assert all(value['cut']==opened[-1]['cut'] for value in pages)
        assert any(value['nextCursor'] for value in pages if 'nextCursor' in value)
        await page.screenshot(path=str(evidence/'history.png'),full_page=True)
        # Labelled public Remote fault: a disposed or foreign cursor never yields an empty successful history.
        await page.route('**/api/ompHistoryFixture/read',lambda route: route.fulfill(json={
            'type':'server-response','rpcId':route.request.post_data_json['rpcId'],
            'result':{'ok':True,'value':{'status':'error','code':'history_stale_cursor'}}}))
        await page.locator('#refresh').click()
        await page.get_by_text('history_stale_cursor',exact=True).wait_for()
        build_text=Path('packages/contracts/generated/identity.ts').read_text()
        omp_build=json.loads(build_text.split(' = ',1)[1].strip().removesuffix(';'))
        dsh_build=json.loads(Path('vendor/dsh-history/manifest.json').read_text())
        fixture_files=['compatibility/omp/fixtures/history-rpc.js','compatibility/omp/fixtures/history-network-guard.js','compatibility/omp/fixtures/no-provider.ts','apps/history-fixture/server.ts','packages/compatibility/history-transport.ts']
        fixture_hashes={name:hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in fixture_files}
        result={'fixtureSha256':fixture_hashes,'bunLockSha256':hashlib.sha256(Path('bun.lock').read_bytes()).hexdigest(),'ompBuild':omp_build,'dshBuild':{key:dsh_build[key] for key in ['dshBase','sourceSha256','contractSha256','assets']},'kind':'actual-dsh-bun-native-fixture','browser':browser.version,'platform':'Linux Chromium',
            'privateSessionAdmission':'blocked','cases':{'sameCutPagedActiveFullTreeAndRunning':'PASS',
            'retainedBoundariesFoldedAndExpandable':'PASS','nativeRetainedImagePreview':'PASS','hiddenStateNotExposed':'PASS','publicRemoteStaleCursorFault':'PASS'},
            'nativePageResponses':len(pages),'windows':'DEFERRED'}
        (evidence/'browser.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
        await browser.close()

asyncio.run(main())
