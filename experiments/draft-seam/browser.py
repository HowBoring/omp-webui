"""Actual Linux Chromium + built DSH Client + public provider/Remote fixture. No Host-original-store claim."""
import json
import os
import platform
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'experiments/draft-seam/evidence')
port = json.loads((root / 'server.json').read_text())['port']
base = f'http://127.0.0.1:{port}'
report = {'platform': platform.platform(), 'scope': 'public DSH Client/provider/Remote fixture; synthetic originals only', 'checks': [], 'pageErrors': []}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE', '/usr/bin/chromium'), headless=True,
                                args=['--no-sandbox'] if sys.platform == 'linux' else [])
    report['chromium'] = browser.version
    context = browser.new_context(viewport={'width': 1500, 'height': 1100})
    context.add_init_script("""
      localStorage.setItem('dsh.conversation.fixture-existing', JSON.stringify({draft:'shared other-tab text'}));
      window.__fixtureSharedReads = 0; window.__fixtureSharedWrites = 0;
      const read = Storage.prototype.getItem; const write = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) {
        if (this === localStorage && key === 'dsh.conversation.fixture-existing') window.__fixtureSharedReads++;
        return read.call(this, key);
      };
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage && key === 'dsh.conversation.fixture-existing') window.__fixtureSharedWrites++;
        return write.call(this, key, value);
      };
    """)

    def capture(page):
        page.on('pageerror', lambda e: report['pageErrors'].append(str(e)))

    def ready(page):
        page.wait_for_function("() => JSON.parse(document.querySelector('#draft-state')?.textContent ?? '{}').ready === true")

    def state(page):
        return json.loads(page.locator('#draft-state').inner_text())

    def action(page, name):
        page.locator(f'[data-draft={name}]').click()
        page.wait_for_function("() => JSON.parse(document.querySelector('#draft-state').textContent).result?.status !== 'pending'")
        assert state(page)['result']['status'] != 'error', state(page)

    def open_a(page):
        action(page, 'open-a')
        page.locator('[data-composer-input=true]').wait_for()

    def edit(page, text):
        page.locator('[data-composer-input=true]').fill(text)
        page.wait_for_function("text => JSON.parse(document.querySelector('#draft-state').textContent).semantic.draft.text === text", arg=text)

    def saved(page):
        return page.evaluate("JSON.parse(sessionStorage.getItem('omp.fixture.semantic-drafts.v1'))")

    page = context.new_page()
    capture(page)
    try:
        page.goto(base)
        ready(page)
        open_a(page)
        assert state(page)['semantic']['draft']['text'] == ''
        assert page.evaluate('window.__fixtureSharedReads') == 0
        assert page.evaluate('window.__fixtureSharedWrites') == 0
        edit(page, 'Tab A — native A draft')
        owner_a = state(page)['owner']
        second = context.new_page()
        capture(second)
        second.goto(base)
        ready(second)
        open_a(second)
        assert state(second)['owner'] != owner_a
        assert state(second)['semantic']['draft']['text'] == ''
        edit(second, 'Tab B independent draft')
        assert state(page)['semantic']['draft']['text'] == 'Tab A — native A draft'
        report['checks'].append('two live tabs, one Session: no shared draft reads/writes')

        action(page, 'open-b')
        assert state(page)['semantic']['draft']['text'] == ''
        edit(page, 'Tab A — native B draft')
        open_a(page)
        assert state(page)['semantic']['draft']['text'] == 'Tab A — native A draft'
        before_refresh = saved(page)
        page.reload()
        ready(page)
        assert state(page)['owner'] == owner_a
        open_a(page)
        assert state(page)['semantic']['draft']['text'] == 'Tab A — native A draft'
        assert saved(page) == before_refresh
        report['checks'].append('two Sessions, same tab; refresh restores same tab owner without clock renewal or send')

        with page.expect_popup() as popup:
            page.locator('[data-draft=duplicate]').click()
        duplicate = popup.value
        capture(duplicate)
        ready(duplicate)
        open_a(duplicate)
        assert state(duplicate)['owner'] != owner_a
        assert state(duplicate)['semantic']['draft']['text'] == 'Tab A — native A draft'
        edit(duplicate, 'Duplicated tab now independent')
        assert state(page)['semantic']['draft']['text'] == 'Tab A — native A draft'
        assert state(second)['semantic']['draft']['text'] == 'Tab B independent draft'
        report['checks'].append('actual window.open copies sessionStorage; Web Lock rotates duplicated owner and edits stay isolated')

        action(page, 'sample')
        semantic = state(page)['semantic']
        assert semantic['draft']['text'] == '/saved @a @a\n> quoted'
        assert semantic['draft']['command'] == {'token': '/saved '}
        assert [r['offset'] for r in semantic['draft']['references']] == [7, 10]
        assert semantic['draft']['quotes'] == [{'offset': 13, 'length': 8, 'text': 'quoted'}]
        assert [r['id'] for r in semantic['originals']] == ['original-b', 'original-a', 'original-b']
        assert all(item['status'] == 'ready' for item in semantic['readiness'])
        assert page.locator('[data-composer-chip=reference]').count() == 2
        assert page.locator('[data-composer-quote]').count() == 1
        page.wait_for_function("document.querySelectorAll('[data-composer-card] div[title$=\".txt\"]').length === 3")
        assert page.locator('[data-composer-card] div[title$=".txt"]').evaluate_all(
            "cards => cards.map(card => card.title)") == ['second.txt', 'first.txt', 'second.txt']
        old_runtime_ids = [r['attachmentId'] for r in semantic['readiness']]
        original_saved = saved(page)
        assert 'receipt' not in json.dumps(original_saved).lower()
        assert 'blob:' not in json.dumps(original_saved)
        page.screenshot(path=str(root / 'semantic-draft.png'))
        page.reload()
        ready(page)
        open_a(page)
        restored = state(page)['semantic']
        assert restored['draft'] == semantic['draft']
        assert restored['originals'] == semantic['originals']
        assert [r['attachmentId'] for r in restored['readiness']] != old_runtime_ids
        assert saved(page) == original_saved
        report['checks'].append('real chips/quotes/command, stock attachment cards and repeated original order survive refresh; handles/receipts rebuilt')

        action(page, 'missing')
        missing = state(page)['semantic']
        assert missing['draft'] == semantic['draft']
        assert missing['originals'][0]['id'] == 'missing'
        assert missing['readiness'] == [{'status': 'invalid', 'reason': 'Original missing or expired'}]
        page.locator('[data-composer-input=true]').press('Enter')
        assert state(page)['semantic']['phase'] == 'plain'
        report['checks'].append('missing original preserves semantic text and visible reason; manual Enter cannot submit partial draft')

        action(page, 'clear')
        edit(page, 'New input before delayed restore')
        action(page, 'delay')
        page.locator('[data-draft=sample]').click()
        page.wait_for_function("JSON.parse(document.querySelector('#draft-state').textContent).result.status === 'pending'")
        edit(page, 'Newer user edit while preparing')
        page.locator('[data-draft=release]').click()
        page.wait_for_function("JSON.parse(document.querySelector('#draft-state').textContent).result.reason === 'revision'")
        assert state(page)['semantic']['draft']['text'] == 'Newer user edit while preparing'
        report['checks'].append('late preparation cannot replace a newer browser edit')

        status = page.request.get(base + '/probe/status').json()
        assert not [c for c in status['requests'] if c['endpoint'] in ['session/prompt', 'session/create']]
        assert len(status['uploads']) >= 6
        assert len({u['receiptId'] for u in status['uploads']}) == len(status['uploads'])
        report['sharedKeyReads'] = page.evaluate('window.__fixtureSharedReads')
        report['sharedKeyWrites'] = page.evaluate('window.__fixtureSharedWrites')
        assert report['sharedKeyReads'] == 0 and report['sharedKeyWrites'] == 0
        assert page.evaluate("JSON.parse(localStorage.getItem('dsh.conversation.fixture-existing')).draft") == 'shared other-tab text'
        assert not report['pageErrors'], report['pageErrors']
        report['checks'].append('no prompt/create Remote calls; shared legacy key unchanged; fresh raw upload receipts distinct')
        # Actual public Remote request remains delayed while a same-tab refresh destroys the old Client.
        page.request.get(base + '/probe/prompt-mode?value=delay')
        action(page, 'pending-sample')
        page.locator('[data-composer-input=true]').press('Enter')
        page.wait_for_function("JSON.parse(document.querySelector('#draft-state').textContent).semantic.unresolved !== undefined")
        for _ in range(100):
            pending_status = page.request.get(base + '/probe/status').json()
            if len([c for c in pending_status['requests'] if c['endpoint'] == 'session/prompt']) == 1:
                break
            page.wait_for_timeout(30)
        assert len([c for c in pending_status['requests'] if c['endpoint'] == 'session/prompt']) == 1
        protected = state(page)['semantic']['unresolved']
        assert protected['draft']['text'] == 'Unresolved attached input'
        assert [r['id'] for r in protected['originals']] == ['original-b', 'original-a', 'original-b']
        pending_saved = saved(page)
        assert any(r['record'].get('unresolved', {}).get('id') == protected['id'] for r in pending_saved['records'].values())
        assert 'receipt' not in json.dumps(pending_saved).lower()
        prompt = [c for c in pending_status['requests'] if c['endpoint'] == 'session/prompt'][0]
        args = prompt['payload'].get('args', prompt['payload'])
        assert pending_saved['dispatches'][protected['id']]['requestId'] == args['request']['requestId']
        uploads_before = len(pending_status['uploads'])
        page.reload()
        ready(page)
        open_a(page)
        assert state(page)['semantic']['unresolved'] == protected
        assert state(page)['semantic']['phase'] == 'sending'
        assert state(page)['semantic']['draft']['text'] == 'Unresolved attached input'
        assert all(r['status'] == 'invalid' for r in state(page)['semantic']['readiness'])
        assert page.locator('[data-composer-input=true]').get_attribute('contenteditable') == 'false'
        assert saved(page) == pending_saved
        action(page, 'recover')
        assert state(page)['result'] == {'status': 'blocked', 'reason': 'unknown'}
        page.locator('[data-composer-input=true]').press('Enter')
        refreshed_status = page.request.get(base + '/probe/status').json()
        assert len([c for c in refreshed_status['requests'] if c['endpoint'] == 'session/prompt']) == 1
        assert len(refreshed_status['uploads']) == uploads_before
        page.screenshot(path=str(root / 'unresolved-after-refresh.png'))
        report['checks'].append('delayed public Remote acceptance plus same-tab refresh: durable frozen text/originals, no upload, no replay, unknown recovery blocked')

        page.request.get(base + '/probe/release-prompt?outcome=accepted')
        assert state(page)['semantic']['unresolved'] == protected
        action(page, 'recover')
        assert state(page)['result'] == {'status': 'applied'}
        assert state(page)['semantic']['phase'] == 'plain'
        assert state(page)['semantic']['draft']['text'] == ''
        assert state(page)['semantic'].get('unresolved') is None
        report['checks'].append('late acceptance never clears refreshed quarantine; explicit authoritative fixture outcome durably resolves without replay')

        page.request.get(base + '/probe/prompt-mode?value=drop')
        edit(page, 'Unknown outcome after failed Remote response')
        page.locator('[data-composer-input=true]').press('Enter')
        page.wait_for_function("JSON.parse(document.querySelector('#draft-state').textContent).semantic.unresolved !== undefined")
        for _ in range(100):
            failed_status = page.request.get(base + '/probe/status').json()
            if len({c['rpcId'] for c in failed_status['requests'] if c['endpoint'] == 'session/prompt'}) == 2:
                break
            page.wait_for_timeout(30)
        assert len({c['rpcId'] for c in failed_status['requests'] if c['endpoint'] == 'session/prompt'}) == 2
        unknown_marker = state(page)['semantic']['unresolved']
        page.reload()
        ready(page)
        open_a(page)
        assert state(page)['semantic']['unresolved'] == unknown_marker
        assert state(page)['semantic']['phase'] == 'sending'
        assert state(page)['semantic']['draft']['text'] == 'Unknown outcome after failed Remote response'
        action(page, 'recover')
        assert state(page)['result']['reason'] == 'unknown'
        page.request.get(base + '/probe/release-prompt?outcome=not-submitted')
        action(page, 'recover')
        assert state(page)['semantic']['phase'] == 'plain'
        assert state(page)['semantic']['draft']['text'] == 'Unknown outcome after failed Remote response'
        status = page.request.get(base + '/probe/status').json()
        assert len({c['rpcId'] for c in status['requests'] if c['endpoint'] == 'session/prompt'}) == 2
        report['checks'].append('failed Remote reply stays unknown across refresh; explicit not-submitted decision restores input without automatic send')

        action(page, 'fail-checkpoint')
        edit(page, 'Storage failure must not execute')
        page.locator('[data-composer-input=true]').press('Enter')
        page.wait_for_function("JSON.parse(document.querySelector('#draft-state').textContent).semantic.unresolved !== undefined")
        page.wait_for_timeout(100)
        status = page.request.get(base + '/probe/status').json()
        assert len({c['rpcId'] for c in status['requests'] if c['endpoint'] == 'session/prompt'}) == 2
        assert state(page)['semantic']['draft']['text'] == 'Storage failure must not execute'
        assert state(page)['semantic']['phase'] == 'sending'
        action(page, 'withdraw')
        assert state(page)['semantic']['unresolved']['draft']['text'] == 'Storage failure must not execute'
        report['checks'].append('provider checkpoint storage failure and withdrawal retain frozen text; no Remote execution')
        prompt_calls = [c for c in status['requests'] if c['endpoint'] == 'session/prompt']
        logical = {}
        for call in prompt_calls:
            prior = logical.setdefault(call['rpcId'], call['payload'])
            assert prior == call['payload'], 'carrier retransmission changed the original prompt'
        assert len(logical) == 2
        assert len({payload['args']['request']['requestId'] for payload in logical.values()}) == 2
        dispatched_ids = list(saved(page).get('dispatches', {}))
        assert set(dispatched_ids) == {protected['id'], unknown_marker['id']}
        local_ids = [protected['id'], unknown_marker['id'], state(page)['semantic']['unresolved']['id']]
        assert len(set(local_ids)) == 3
        report['localDraftSubmissionIds'] = local_ids
        report['dispatchedLocalDraftSubmissionIds'] = dispatched_ids
        report['dshSessionRequestIds'] = [payload['args']['request']['requestId'] for payload in logical.values()]
        report['outerRpcIds'] = list(logical)
        report['logicalPromptCalls'] = len(logical)
        report['physicalPromptRequests'] = len(prompt_calls)
        report['carrierRetransmissions'] = len(prompt_calls) - len(logical)
        assert not [c for c in status['requests'] if c['endpoint'] == 'session/create']
        assert not report['pageErrors'], report['pageErrors']
        report['uploads'] = status['uploads']
        report['result'] = 'PASS'
        report['final'] = state(page)
    except Exception as error:
        report['result'] = 'FAIL'
        report['failure'] = str(error)
        page.screenshot(path=str(root / 'failure.png'))
        raise
    finally:
        (root / 'browser.json').write_text(json.dumps(report, indent=2) + '\n')
        browser.close()
print(json.dumps({'result': report['result'], 'checks': len(report['checks'])}))
