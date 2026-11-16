"""Full stock DSH graph + one real guarded native worker, two tabs and public APIs only."""
import json,os,platform,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(sys.argv[1] if len(sys.argv)>1 else 'experiments/projection-seam/native-evidence')
base='http://127.0.0.1:'+str(json.loads((root/'server.json').read_text())['port'])
report={'scope':'actual native RPC+Ask+Bridge+LiveJournal+full built DSH graph; literal in-process provider only','platform':platform.platform(),'base':base,'checks':[],'pageErrors':[],'consoleErrors':[],'expectedFailures':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-background-networking'])
    report['chromium']=browser.version
    context=browser.new_context(viewport={'width':1700,'height':1200})
    context.route('**/*',lambda route:route.continue_() if route.request.url.startswith((base,'data:','blob:')) else route.abort())
    def track(tab):
        tab.on('pageerror',lambda error:report['pageErrors'].append(str(error)))
        tab.on('console',lambda message:(report['expectedFailures'] if 'controlled_native_history_failure' in message.text else report['consoleErrors']).append(message.text) if message.type=='error' else None)
    context.on('page',track)
    def page():
        tab=context.new_page();tab.goto(base);ready(tab);return tab
    def state(tab):return json.loads(tab.locator('#projection-state').inner_text())
    def ready(tab):tab.wait_for_function("() => JSON.parse(document.querySelector('#projection-state')?.textContent??'{}').projection?.phase==='ready'",timeout=30000)
    def info(tab):return tab.evaluate("async()=>await(await fetch('/fixture/info')).json()")
    def native(tab,op):return tab.evaluate("async op=>{const r=await fetch('/fixture/native-action?op='+op);if(!r.ok)throw Error(await r.text());return r.json()}",op)
    def fault(tab,op):return tab.evaluate("async op=>await(await fetch('/fixture/action?op='+op)).json()",op)
    def action(tab,op):
        tab.locator('[data-projection="'+op+'"]').click()
        tab.wait_for_function("()=>JSON.parse(document.querySelector('#projection-state').textContent).result?.status!=='pending'")
        result=state(tab)['result'];assert result.get('status')!='error',result;return result
    def waiting(tab):
        tab.wait_for_function("async()=>{const n=(await(await fetch('/fixture/info')).json()).native;return n.rebuilding&&n.historyFault.waiting===1}")
    def wire(tab,name,cancel=False):
        tab.evaluate("""async ({name,cancel})=>{
          const socket=new WebSocket(location.origin.replace('http','ws')+'/api/remote.mux');
          const frames=[];window[name]={socket,frames};socket.onmessage=e=>frames.push(JSON.parse(e.data));
          await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
          socket.send(JSON.stringify({type:'open',streamId:'proof-control',endpoint:'session/control',payload:{args:{}}}));
          if(cancel)socket.send(JSON.stringify({type:'cancel',streamId:'proof-control'}));
        }""",{'name':name,'cancel':cancel})
    first=second=joiningFailed=None
    try:
        first=page();second=page()
        for tab,text in [(first,'Native tab A draft'),(second,'Native tab B draft')]:
            action(tab,'sample');tab.locator('[data-composer-input=true]').fill(text)
            tab.wait_for_function("text=>JSON.parse(document.querySelector('#projection-state').textContent).semantic.draft.text===text",arg=text)
        print('native-browser: drafts ready',flush=True)
        before=info(first)['native'];initial=[state(tab)['semantic'] for tab in [first,second]]
        first.get_by_text('NATIVE OFF BRANCH ORIGINAL',exact=True).first.wait_for()
        action(first,'retain');action(first,'release-extra')
        print('native-browser: asking',flush=True)
        native(first,'ask')
        for tab in [first,second]:tab.wait_for_function("()=>JSON.parse(document.querySelector('#projection-state').textContent).nativeInteraction?.pending?.[0]?.method==='select'")
        card=state(first)['nativeInteraction']['pending'][0]
        report['nativeQuestion']=card
        pending=fault(first,'interaction')['interaction']
        for tab in [first,second]:tab.wait_for_function("()=>JSON.parse(document.querySelector('#projection-state').textContent).pending?.kind==='approval'")
        gateway_key=state(first)['pending']['key']
        print('native-browser: model',flush=True)
        native(first,'hold-history');native(first,'model');waiting(first)
        joining=context.new_page();joining.goto(base,wait_until='commit')
        wire(first,'cancelledControl',True)
        wire(first,'joinedControl')
        assert first.evaluate('window.joinedControl.frames.length')==0
        assert state(first)['projection']['phase']=='rebuilding'
        native(first,'release-history')
        ready(joining)
        first.wait_for_function("()=>window.joinedControl.frames[0]?.value?.type==='baseline'")
        assert first.evaluate('window.cancelledControl.frames.length')==0
        joined_info=info(joining)['native']
        assert joined_info['process']==before['process'] and joined_info['interaction']['pending'][0]==card
        report['controlDuringRebuild']=first.evaluate('window.joinedControl.frames')
        first.evaluate('window.joinedControl.socket.close();window.cancelledControl.socket.close()')
        joining.close()
        report['checks'].append('controlled public history-open hold: new full DSH tab and control stream wait for current baseline; cancelled control emits nothing; same native Ask and worker survive')
        for tab in [first,second]:
            tab.wait_for_function("old=>{const s=JSON.parse(document.querySelector('#projection-state').textContent);return s.projection.phase==='ready'&&s.projection.binding.generation!==old}",arg=before['projection']['generation'],timeout=30000)
        after=info(first)['native']
        assert before['sessionId']==after['sessionId']
        assert before['cut']['sourceId']==after['cut']['sourceId'] and before['cut']['workerId']==after['cut']['workerId']
        assert before['cut']['contextId']!=after['cut']['contextId']
        assert before['process']==after['process']
        for index,tab in enumerate([first,second]):
            now=state(tab);assert now['bindingStable'] and now['scopeStable']
            assert now['nativeInteraction']['pending'][0]==card
            assert now['pending']['key']==gateway_key
            assert now['semantic']['draft']==initial[index]['draft']
            assert now['semantic']['originals']==initial[index]['originals']
            assert now['semantic']['scope']['storageKey']==initial[index]['scope']['storageKey']
        assert fault(first,'interaction')['interaction']['deadline']==pending['deadline']
        report['checks'].append('public native model context change rebuilds both tabs in place; exact native Session/source/worker/PID, builtin Ask ID/deadline, real Gateway invocation, independent drafts and originals survive')
        first.get_by_role('button',name='Allow once',exact=True).first.click()
        for tab in [first,second]:tab.wait_for_function("()=>JSON.parse(document.querySelector('#projection-state').textContent).pending===null")
        native(first,'hold-history');native(first,'model-first');waiting(first)
        count=first.evaluate("async()=>{const s=await(await fetch('/probe/status')).json();return s.frames.filter(f=>f.type==='open'&&f.endpoint==='session/control').length}")
        joiningFailed=context.new_page();joiningFailed.goto(base,wait_until='commit')
        first.wait_for_function("async count=>{const s=await(await fetch('/probe/status')).json();return s.frames.filter(f=>f.type==='open'&&f.endpoint==='session/control').length>count}",arg=count)
        fault(first,'connection-ready')
        wire(first,'failedControl')
        native(first,'fail-history')
        for tab in [first,second,joiningFailed]:
            tab.wait_for_function("()=>JSON.parse(document.querySelector('#projection-state')?.textContent??'{}').projection?.phase==='failed'")
            tab.wait_for_function("id=>JSON.parse(document.querySelector('#projection-state').textContent).nativeInteraction?.pending[0]?.id===id",arg=card['id'])
            assert state(tab)['nativeInteraction']['pending'][0]==card
        first.wait_for_function("()=>window.failedControl.frames[0]?.type==='error'")
        failed=info(first)['native']
        assert failed['interaction']['pending'][0]==card and failed['process']==before['process']
        wire(first,'reconnectedControl')
        first.wait_for_function("()=>window.reconnectedControl.frames[0]?.type==='error'")
        for name in ['failedControl','reconnectedControl']:
            frames=first.evaluate('name=>window[name].frames',name)
            assert frames[0]['error']['code']=='gateway/internal' and not any(frame['type']=='item' for frame in frames)
            report[name]=frames;first.evaluate('name=>window[name].socket.close()',name)
        report['failedRebuild']=failed
        assert action(joiningFailed,'native-chosen')['status']=='answered'
        first.wait_for_function("()=>JSON.parse(document.querySelector('#projection-state').textContent).nativeInteraction.pending[0]?.method==='editor'")
        editor=state(first)['nativeInteraction']['pending'][0]
        report['nativeEditor']=editor
        assert editor['generation']==card['generation']
        assert editor['createdAt']>=card['createdAt']
        assert editor['deadline']-editor['createdAt'] < card['deadline']-card['createdAt']
        assert action(joiningFailed,'native-repeat')['status']=='stale'
        report['answeredWhileFailed']=state(joiningFailed)['projection']['phase']=='failed'
        assert report['answeredWhileFailed']
        native(first,'retry')
        for tab in [first,second,joiningFailed]:
            action(tab,'retry');ready(tab)
            assert state(tab)['nativeInteraction']['pending'][0]==editor
        for index,tab in enumerate([first,second]):
            assert state(tab)['semantic']['draft']==initial[index]['draft']
            assert state(tab)['semantic']['originals']==initial[index]['originals']
        report['joiningAfterRecovery']=state(joiningFailed)
        report['checks'].append('failed actual-native rebuild plus physical browser reconnect: typed control failures without baseline, withdrawn rows, original Ask ID/deadline and same worker/PID; public projection retry restores control observation before presentation readiness')
        assert action(first,'native-chosen')['status']=='answered'
        assert action(first,'native-repeat')['status']=='stale'
        for tab in [first,second]:tab.wait_for_function("()=>JSON.parse(document.querySelector('#projection-state').textContent).pending===null&&JSON.parse(document.querySelector('#projection-state').textContent).nativeInteraction.pending.length===0")
        for _ in range(400):
            settled=info(first)['native']['state']
            if settled['isSettled'] and not settled['isStreaming']: break
            first.wait_for_timeout(25)
        else: raise AssertionError('Native worker did not settle')
        report['checks'].append('original native select and editor explicitly answered once through typed Remote and accepted Bridge; repeated old answer stale; independent Gateway invocation settles stock approval UI')
        before_rewind=info(first)['native'];native(first,'rewind')
        for tab in [first,second,joiningFailed]:
            tab.wait_for_function("old=>{const s=JSON.parse(document.querySelector('#projection-state').textContent);return s.projection.phase==='ready'&&s.projection.binding.generation!==old}",arg=before_rewind['projection']['generation'],timeout=30000)
            assert tab.get_by_text('NATIVE OFF BRANCH ORIGINAL',exact=True).count()==0
            assert tab.get_by_text('ASK_FOR_PROJECTION_PROOF',exact=True).count()==0
        after_rewind=info(first)['native']
        assert before['process']==after_rewind['process'] and before['sessionId']==after_rewind['sessionId']
        assert after_rewind['cut']['durability']=='not_attested'
        report['checks'].append('actual idle native branch navigation rotates projection and withdraws off-branch rows in all three views after public retry, including the failed joining holder; worker and drafts survive; native durability remains not_attested')
        report.update(before=before,afterContextChange=after,afterRewind=after_rewind,nativeQuestion=card,nativeEditor=editor,states=[state(first),state(second),state(joiningFailed)])
        first.screenshot(path=str(root/'native-same-id.png'),full_page=True)
        joiningFailed.close();joiningFailed=None
        first.close();second.close();first=second=None
        fresh=page();assert state(fresh)['id']==before['sessionId'];assert info(fresh)['native']['process']==before['process']
        report['checks'].append('final browser-holder release and a new holder reopen the same native Session and worker without any stale projection callback')
        fresh.close()
    finally:
        report['finalStates']=[state(tab) for tab in [first,second] if tab and not tab.is_closed()]
        (root/'browser.json').write_text(json.dumps(report,indent=2)+'\n');browser.close()
