"""Actual Linux Chromium → authenticated DSH Remote/Peer/$events → Bun → public OMP catalog.
All native profiles are deliberately synthetic; never print bootstrap links or cookie material.
"""
import hashlib, json, os, platform, shutil, socket, subprocess, time, urllib.error, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]
BUN = shutil.which('bun') or '/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun'
ORIGIN = 'http://127.0.0.1:3182'
ENTRY = 'vendor/host-workspaces/workspace-component-main.js'
OUT = ROOT / 'vendor/workspace-evidence'
CHROME = os.environ.get('CHROME_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
assert CHROME, 'Chromium/Chrome executable not found; set CHROME_EXECUTABLE'

def native_manifest():
    result = {}
    for base in [ROOT/'vendor/workspace-fixture/.omp', ROOT/'vendor/workspace-fixture/custom']:
        for file in sorted(base.rglob('*')):
            info = file.lstat()
            result[str(file.relative_to(ROOT))] = [info.st_ino, info.st_size, info.st_mtime_ns,
                hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None]
    return result

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lock_module = str(ROOT/'vendor/omp-runtime/node_modules/@oh-my-pi/pi-utils/src/file-lock.ts')
    lock_code = f'import {{tryAcquireFileLock}} from {json.dumps(lock_module)}; const lock=tryAcquireFileLock({json.dumps(str(ROOT/"vendor/workspace-fixture/.omp/run/session-owners/native-0000"))}); if(!lock)process.exit(4);console.log("held");await Bun.stdin.text();lock.release();'
    lock = subprocess.Popen([BUN,'--no-env-file','-e',lock_code],cwd=ROOT,
        env={'HOME':str(ROOT/'vendor/workspace-fixture'),'BUN_RUNTIME_TRANSPILER_CACHE_PATH':'0'},
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    assert lock.stdout.readline().strip()=='held'
    before = native_manifest()
    class Cases(list):
        def append(self, item):
            super().append(item); print(item, flush=True)
    host = None; logs = ''; cases = Cases()
    def start():
        nonlocal host
        host = subprocess.Popen([BUN, '--no-env-file', ENTRY], cwd=ROOT,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.monotonic()+180
        while time.monotonic()<deadline:
            assert host.poll() is None, f'Component Host exited: {host.communicate()[0][-4000:]}'
            try:
                with socket.create_connection(('127.0.0.1',3182), timeout=.2):break
            except OSError:time.sleep(.1)
        else: raise AssertionError('Component Host readiness timeout')
        def serving():
            try:
                with urllib.request.urlopen(ORIGIN+'/healthz', timeout=1) as response:
                    return response.status==200 and json.loads(response.read())['status']=='ok'
            except (OSError, urllib.error.URLError, ValueError): return False
        while time.monotonic()<deadline and not serving():
            assert host.poll() is None, f'Component Host exited before serving: {host.communicate()[0][-4000:]}'
            time.sleep(.1)
        assert serving(), 'Component Host did not serve /healthz'
        print(f'host pid {host.pid} serving {ORIGIN}', flush=True)
    def stop(crash=False):
        nonlocal host, logs
        if host:
            children=subprocess.run(['ps','--ppid',str(host.pid),'-o','pid='],capture_output=True,text=True).stdout.split()
            host.kill() if crash else host.terminate()
            output,_=host.communicate(timeout=15); logs+=output
            assert host.returncode==(-9 if crash else 0), f'Host exit {host.returncode}: {output[-4000:]}'
            host=None
            def running(pid):
                try:return 'State:\tZ' not in Path(f'/proc/{pid}/status').read_text()
                except OSError:return False
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                alive=[pid for pid in children if running(pid)]
                if not alive:break
                time.sleep(.05)
            assert not alive,'Readonly native child survived Host loss/shutdown'
    def bootstrap():
        return subprocess.check_output([BUN,'--no-env-file',ENTRY,'--print-bootstrap'],cwd=ROOT,text=True).strip()
    try:
        start()
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox'])
            context=browser.new_context(); page=context.new_page(); errors=[]; calls=[]; mux=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda req:calls.append(req.post_data_json) if '/api/ompWorkspaces/' in req.url else None)
            page.on('websocket',lambda ws:ws.on('framesent',lambda frame:mux.append(frame)))
            assert context.request.post(ORIGIN+'/api/ompWorkspaces/grants',data='private').status==403
            assert context.request.get(ORIGIN+'/').status==401
            page.goto(bootstrap()); assert page.url==ORIGIN+'/'
            page.locator('#catalog[data-status="partial"]').wait_for(timeout=60000)
            assert 'INVALID_SOURCE' in page.locator('#catalog').inner_text()
            assert 'INVALID_METADATA' in page.locator('#catalog').inner_text()
            page.locator('#registered article[data-native-status="missing"]').wait_for()
            registered_statuses=page.locator('#registered article').evaluate_all('(rows)=>rows.map(row=>row.dataset.nativeStatus)')
            assert registered_statuses[:5]==['verified','replaced','missing','source_unavailable','invalid_reference'],registered_statuses
            assert len(registered_statuses)==32
            assert 'ownership held' in page.locator('#registered article').first.inner_text()
            assert 'ownership unknown' in page.locator('#registered article[data-native-status="missing"]').inner_text()
            page.locator('#registered-next').click()
            page.locator('#registered article').filter(has_text='synthetic-registered-native-0029').wait_for()
            assert page.locator('#registered article').count()==3
            assert page.locator('#registered-next').is_disabled()
            cases.append('PASS separate readonly Session Index provider pagination reaches all 35 explicit synthetic references')
            page.locator('#refresh').click();page.locator('#catalog[data-status="partial"]').wait_for()
            cases.append('PASS explicit synthetic Session Index metadata maps actual public describe verified/held, replaced, missing, invalid and source unavailable; failed references retained with unknown ownership')
            sources=page.locator('#sources').inner_text()
            assert 'Selected native profile: default' in sources
            cases.append('PASS auth root exchange + actual native partial/errors through typed DSH')
            project=str(ROOT/'vendor/workspace-fixture/project')
            # A repeat run starts with explicit owner revocation of prior synthetic grants.
            for button in page.get_by_role('button',name='Revoke directory').all():
                button.click()
                page.wait_for_function('() => document.querySelectorAll("#grants p").length===0 && document.querySelectorAll("#catalog article[data-directory=authorized]").length===0')
            assert page.locator('#catalog article[data-directory="authorized"]').count()==0
            page.get_by_label('Directory path').fill(project)
            page.get_by_role('button',name='Review directory',exact=True).click()
            page.get_by_text('Canonical target:',exact=False).wait_for()
            assert project in page.locator('#confirmation').inner_text()
            assert page.locator('#catalog article[data-directory="authorized"]').count()==0
            page.get_by_role('button',name='Grant this canonical directory and descendants').click()
            page.locator('#catalog article[data-directory="authorized"]').first.wait_for()
            assert page.locator('#sources').inner_text()==sources
            cases.append('PASS explicit canonical review/confirmation; web grant leaves profile/sources fixed')
            observed={}; rows=0
            while True:
                page.locator('#catalog[data-status="partial"]').wait_for()
                for row in page.locator('#catalog article').all():
                    observed[row.get_attribute('data-native-id')]=row.get_attribute('data-directory');rows+=1
                if page.locator('#next').is_disabled():break
                page.locator('#next').click()
            assert rows==47,(rows,errors)
            assert observed['child']=='authorized' and observed['prefix']=='ungranted' and observed['escape']=='ungranted'
            assert observed['unknown']=='unknown' and observed['missing']=='missing'
            assert len([key for key in observed if key.startswith('native-')])==40
            cases.append('PASS every native page reachable; child/prefix/symlink/unknown/missing states; discovery only')
            csrf=context.request.get(ORIGIN+'/auth/status').json()['csrf']
            envelope={'type':'client-request','rpcId':'negative','method':'ompWorkspaces/preview','payload':{'args':{'path':project}}}
            assert context.request.post(ORIGIN+'/api/ompWorkspaces/preview',data=envelope,headers={'Origin':ORIGIN}).status==403
            assert context.request.post(ORIGIN+'/api/ompWorkspaces/preview',data=envelope,headers={'Origin':'null','x-omp-csrf':csrf}).status==403
            assert context.request.get(ORIGIN+'/api/session/history').status==501
            assert context.request.post(ORIGIN+'/api/ompWorkspaces/preview',data={**envelope,'payload':{'args':{'path':project,'sources':['/']}}},headers={'Origin':ORIGIN,'x-omp-csrf':csrf}).status==400
            cases.append('PASS no CSRF/null Origin/source expansion rejected; history/open/execution gates stay closed')
            saved=context.request.get(ORIGIN+'/auth/status').json()
            assert (ROOT/'vendor/workspace-access').stat().st_mode&0o777==0o700
            assert (ROOT/'vendor/workspace-access/directory-grants.sqlite').stat().st_mode&0o777==0o600
            stop(crash=True); start(); page.reload()
            page.locator('#catalog article[data-directory="authorized"]').first.wait_for(timeout=60000)
            assert context.request.get(ORIGIN+'/auth/status').json()==saved
            assert project in page.locator('#grants').inner_text()
            cases.append('PASS actual SIGKILL Host restart restores absolute browser credential and persistent directory grant; readonly native child exits on Host loss')
            # Replace a previously canonical root without modifying any native Session file.
            root=ROOT/'vendor/workspace-fixture/project'; moved=root.with_name('project-original')
            root.rename(moved); root.mkdir()
            try:
                page.locator('#refresh').click();page.locator('#catalog article[data-directory="changed"]').first.wait_for()
                assert 'changed' in page.locator('#grants').inner_text()
                cases.append('PASS actual directory replacement loses rights and reports changed canonical root')
            finally:
                root.rmdir();moved.rename(root)
            page.get_by_role('button',name='Revoke directory').click()
            page.wait_for_function('() => document.querySelectorAll("#grants p").length===0 && document.querySelectorAll("#catalog article[data-directory=authorized]").length===0')
            assert page.locator('#catalog article[data-directory="authorized"]').count()==0
            stop();start();page.reload();page.locator('#catalog[data-status="partial"]').wait_for(timeout=60000)
            assert page.locator('#grants').inner_text()==''
            cases.append('PASS explicit revoke persists across second actual Host restart; no Session worker claimed stopped')
            assert any(isinstance(frame,str) and json.loads(frame).get('endpoint')=='$events' for frame in mux)
            assert all(call['method'].startswith('ompWorkspaces/') for call in calls)
            assert not errors,errors
            page.screenshot(path=str(OUT/'workspaces.png'),full_page=True)
            # Explicit correlation fault is separately labelled and never substituted for native success.
            page.route('**/api/ompWorkspaces/page',lambda route:route.fulfill(json={'type':'server-response','rpcId':'wrong',
                'result':{'ok':True,'value':{'status':'error','code':'CATALOG_STALE'}}}))
            page.locator('#refresh').click();page.get_by_text('catalog_request_failed',exact=True).wait_for()
            cases.append('PASS labelled wrong-correlation carrier fault fails visibly')
            page.unroute('**/api/ompWorkspaces/page')
            # Native public error path: corrupt cursor is passed through stock typed Remote, not browser transport mocking.
            error=context.request.post(ORIGIN+'/api/ompWorkspaces/page',data={'type':'client-request','rpcId':'cursor',
                'method':'ompWorkspaces/page','payload':{'args':{'options':{'cursor':'invalid'}}}},
                headers={'Origin':ORIGIN,'x-omp-csrf':csrf}).json()
            assert error['result']['value']['status']=='error',error
            cases.append('PASS actual public native cursor error maps as explicit typed error')
            browser_version=browser.version;browser.close()
        stop()
        assert before==native_manifest(),'Native metadata/storage was mutated'
        assert 'bootstrap=' not in logs and csrf not in logs
        cases.append('PASS native inode/mtime/content manifest unchanged; routine logs contain no bootstrap/CSRF')
        result={'kind':'actual-authenticated-DSH-Bun-public-OMP-workspace-component','platform':platform.platform(),
            'browser':browser_version,'bun':subprocess.check_output([BUN,'--version'],text=True).strip(),
            'cases':cases,'nativeRows':47,'pageErrors':errors,'DSHRemoteCalls':len(calls),
            'workerRevocation':'BLOCKED pending #44 supervised open; this component has only readonly catalog child',
            'productAdmission':'BLOCKED pending #41 combined/global gates and #44 protected open',
            'registeredReferences':'PASS explicit synthetic readonly index metadata provider and actual public describe; real registration/open/index writes remain #44',
            'windowsWSL2':'DEFERRED by user','performance':'NOT RUN; this is functional component evidence'}
        (OUT/'browser.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
    finally:
        try:stop()
        finally:
            lock.stdin.close(); lock.wait(timeout=10)
            assert lock.returncode==0

if __name__=='__main__':main()
