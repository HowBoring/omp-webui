"""Chromium -> actual DSH Remote/Connection -> Bun -> authored public native RPC; synthetic data only."""
import asyncio,json,os,subprocess
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    output=Path('vendor/continuation-browser');output.mkdir(parents=True,exist_ok=True)
    results={'kind':'actual-DSH-native-strict-continuation','cases':[],'limits':'Linux synthetic fixture; private product admission blocked; no provider inference'}
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=await browser.new_page();errors=[];calls=[];mux=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda req:calls.append(req) if '/api/ompContinuationFixture/' in req.url else None)
        page.on('websocket',lambda ws:ws.on('framesent',lambda frame:mux.append(frame)))
        await page.goto('http://127.0.0.1:3185/')
        await page.locator('#choices[data-status="ready"] article').first.wait_for()
        async def action(selector):
            async with page.expect_response(lambda response:'/api/ompContinuationFixture/act' in response.url) as reply:
                await page.locator(selector).click()
            envelope=await (await reply.value).json();assert envelope['result']['ok'],envelope
            return envelope['result']['value']
        opened=await action('article[data-native-id="native-0000"] button')
        assert opened['state']['phase']=='open' and opened['state']['nativeSessionId']=='native-0000',opened
        starts=opened['worker']['starts'];binding=opened['state']['binding']
        again=await action('article[data-native-id="native-0000"] button')
        assert again['worker']['starts']==starts and again['state']['binding']['instanceId']==binding['instanceId']
        await page.reload();await page.locator('#choices[data-status="ready"] article').first.wait_for()
        checked=await action('#recheck');assert checked['worker']['starts']==starts and checked['state']['nativeSessionId']=='native-0000'
        results['cases'].append({'name':'same-native-identity-and-registration-reuse-without-refresh-replay','result':'PASS','binding':binding})
        await action('#close')
        # Keep actual native ordinary worker alive; Host must reject ownership without killing it.
        root=Path.cwd();home=root/'vendor/continuation-profile';cwd=home/'project';bun='/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun'
        env={'HOME':str(home),'TMPDIR':str(home),'PATH':'/usr/bin:/bin','BUN_RUNTIME_TRANSPILER_CACHE_PATH':'0','PI_CODING_AGENT_DIR':str(home/'.omp/agent'),'NO_COLOR':'1','PI_NOTIFICATIONS':'off','OPENAI_API_KEY':'synthetic-unused-no-provider-calls'}
        argv=[bun,'--no-env-file','--preload',str(root/'compatibility/omp/fixtures/no-provider.ts'),str(root/'vendor/omp-candidate/cli.js'),'--mode','rpc-ui','--session',str(home/'.omp/agent/sessions/bucket/native-0001.jsonl'),'--offline','--provider','openai','--model','gpt-4o','--no-extensions','--no-skills','--no-rules','--no-tools','--no-context-files']
        owner=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            def await_owner():
                while True:
                    line=owner.stdout.readline();assert line,'native owner exited'
                    if json.loads(line).get('type')=='ready':break
                owner.stdin.write(json.dumps({'id':'owner-state','type':'get_state'})+'\n');owner.stdin.flush()
                while True:
                    frame=json.loads(owner.stdout.readline())
                    if frame.get('id')=='owner-state':assert frame['success'];break
                owner.stdin.write(json.dumps({'id':'owner-write','type':'set_model','provider':'openai','modelId':'gpt-4o-mini'})+'\n');owner.stdin.flush()
                while True:
                    frame=json.loads(owner.stdout.readline())
                    if frame.get('id')=='owner-write':assert frame['success'];return
            await asyncio.to_thread(await_owner)
            blocked=await action('article[data-native-id="native-0001"] button')
            assert blocked['registrations'][-1]['attempt']=='failed' and blocked['registrations'][-1]['code']=='STRICT_OCCUPIED',blocked
            assert owner.poll() is None,'Host killed unknown native owner'
            results['cases'].append({'name':'actual-native-owner-contention-no-takeover','result':'PASS'})
        finally:
            owner.stdin.close()
            try:await asyncio.to_thread(owner.wait,8)
            except subprocess.TimeoutExpired:owner.kill();await asyncio.to_thread(owner.wait)
        # Explicit cancellation while actual worker startup is pending.
        await page.locator('article[data-native-id="native-0002"] button').click()
        cancelled=await action('#cancel')
        await asyncio.sleep(.5)
        checked=await action('#recheck')
        assert next(record for record in checked['registrations'] if record.get('nativeSessionId')=='native-0002')['attempt']=='cancelled',checked
        results['cases'].append({'name':'cancel-pending-native-start-no-replay','result':'PASS'})
        await action('#close')
        lost=await action('article[data-native-id="native-0003"] button')
        assert next(record for record in lost['registrations'] if record.get('nativeSessionId')=='native-0003')['attempt']=='outcome_unknown',lost
        lost_starts=lost['worker']['starts'];await asyncio.sleep(.5)
        recovered=await action('article[data-native-id="native-0003"] button')
        for _ in range(10):
            if recovered.get('state',{}).get('phase')=='open':break
            await asyncio.sleep(.2);recovered=await action('#recheck')
        assert json.loads((home/'strict-wire-fault.json').read_text())['nativeResult']=='strict_start_success_dropped'
        assert recovered.get('state',{}).get('phase')=='open' and recovered['state']['nativeSessionId']=='native-0003' and recovered['worker']['starts']==lost_starts,recovered
        results['cases'].append({'name':'lost-result-readonly-state-recovery-without-replay','result':'PASS'})
        await action('#close')
        new=await action('#new');assert new['state']['phase']=='open' and new['state']['intent']=='new' and new['state']['nativeSessionId'] not in [f'native-{n:04d}' for n in range(4)],new
        results['cases'].append({'name':'explicit-new-is-distinct-public-intent-and-native-identity','result':'PASS'})
        await page.screenshot(path=str(output/'continuation.png'),full_page=True)
        await action('#close')
        assert (await page.request.get('http://127.0.0.1:3185/api/sessions')).status==501
        assert any(isinstance(frame,str) and json.loads(frame).get('endpoint')=='$events' for frame in mux),mux
        assert not errors,errors
        results.update(browser=browser.version,DSHRemoteCalls=len(calls),pageErrors=errors,sessionAdmission='blocked')
        await browser.close()
    (output/'browser.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results))
asyncio.run(main())
