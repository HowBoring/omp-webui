"""Controlled public carrier faults; native snapshot allocation and cleanup remain real."""
import asyncio
import uuid

ORIGIN='http://127.0.0.1:3184'

async def prove_history_lifecycle(browser):
    results={}
    for scenario in ['scope-change','generation-loss','dispose']:
        page=await browser.new_page()
        held=asyncio.Event(); release=asyncio.Event(); closed=asyncio.Event()
        allocated=set(); released=set(); delayed=False
        async def carrier(route):
            nonlocal delayed
            options=route.request.post_data_json['payload']['args']['options']
            response=await route.fetch()
            value=(await response.json())['result']['value']
            if value['status']=='opened':
                allocated.add(value['value']['snapshot']); closed.clear()
                if not delayed:
                    delayed=True; held.set(); await release.wait()
            if options['operation']=='close' and value['status']=='closed':
                released.add(options['snapshot'])
                if allocated <= released: closed.set()
            await route.fulfill(response=response)
        await page.route('**/api/ompHistoryFixture/read',carrier)
        await page.goto(ORIGIN)
        await asyncio.wait_for(held.wait(),3)
        if scenario=='scope-change':
            await page.locator('#scope').select_option('tree')
        elif scenario=='generation-loss':
            # Standard browser network events exercise DSH's public Connection recovery.
            await page.evaluate("window.dispatchEvent(new Event('offline'))")
            await page.get_by_text('history_connection_unavailable',exact=True).wait_for()
        else:
            await page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        release.set()
        if scenario=='generation-loss':
            await asyncio.wait_for(closed.wait(),3)
            assert await page.locator('#history li').count()==0
            await page.evaluate("window.dispatchEvent(new Event('online'))")
        if scenario!='dispose':
            await page.wait_for_function("document.querySelector('#state').textContent.includes('readable records')",timeout=3000)
            if scenario=='scope-change':
                for _ in range(10):
                    if await page.locator('#more').is_disabled(): break
                    await page.locator('#more').click()
                    await page.wait_for_function("!document.querySelector('#more').disabled || document.querySelector('#state').textContent.includes('complete')")
                assert 'Background branch' in await page.locator('#history').inner_text()
            closed.clear()
            await page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        await asyncio.wait_for(closed.wait(),3)
        assert allocated and allocated <= released
        assert await page.locator('#history li').count()==0
        # Late controls cannot revive a disposed browser's observation.
        await page.evaluate("document.querySelector('#refresh').click(); document.querySelector('#scope').dispatchEvent(new Event('change'))")
        await page.close()
        results[scenario]={'status':'PASS','nativeSnapshotsAllocated':len(allocated),'nativeSnapshotsClosed':len(allocated & released)}
    # Both bounded slots must be available immediately after the last late open was closed.
    probe=await browser.new_page()
    async def read(options):
        rpc=str(uuid.uuid4())
        response=await probe.request.post(ORIGIN+'/api/ompHistoryFixture/read',headers={'Origin':ORIGIN},data={
            'type':'client-request','rpcId':rpc,'method':'ompHistoryFixture/read','payload':{'args':{'options':options}}})
        assert response.ok, await response.text()
        return (await response.json())['result']['value']
    first=await read({'operation':'open','scope':'tree'})
    second=await read({'operation':'open','scope':'active'})
    assert first['status']==second['status']=='opened'
    try:
        full=await read({'operation':'open','scope':'running'})
        assert full=={'status':'error','code':'history_cache_full'}
        page=await read({'operation':'page','cursor':second['value']['cursor']})
        assert page['status']=='page' and page['value']['items']
    finally:
        for opened in [first,second]:
            assert (await read({'operation':'close','snapshot':opened['value']['snapshot']}))['status']=='closed'
        await probe.close()
    return results
