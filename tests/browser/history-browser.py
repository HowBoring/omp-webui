"""Actual Linux Chromium → DSH typed Remote → Bun → public native RPC, isolated data only."""
import asyncio
import json
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
        assert await page.locator('#history details').count() >= 1
        await page.locator('#scope').select_option('tree')
        await page.wait_for_function("document.querySelector('#state').textContent.includes('128 readable records')")
        for _ in range(10):
            if await page.locator('#more').is_disabled(): break
            await page.locator('#more').click()
            await page.wait_for_function("!document.querySelector('#more').disabled || document.querySelector('#state').textContent.includes('complete')")
        tree=await page.locator('#history').inner_text()
        assert 'Abandoned branch' in tree and 'Background branch' in tree
        assert 'SYNTHETIC_PRIVATE_TOKEN' not in tree
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
        result={'kind':'actual-dsh-bun-native-fixture','browser':browser.version,'platform':'Linux Chromium',
            'privateSessionAdmission':'blocked','cases':{'sameCutPagedActiveAndFullTree':'PASS',
            'retainedBoundariesFolded':'PASS','hiddenStateNotExposed':'PASS','publicRemoteStaleCursorFault':'PASS'},
            'nativePageResponses':len(pages),'windows':'DEFERRED'}
        (evidence/'browser.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
        await browser.close()

asyncio.run(main())
