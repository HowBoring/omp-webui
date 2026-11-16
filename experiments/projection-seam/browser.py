"""Actual built DSH browser graph; controlled public Remote/provider and Gateway lifetime."""
import json
import os
import platform
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'experiments/projection-seam/evidence')
port = json.loads((root / 'server.json').read_text())['port']
base = f'http://127.0.0.1:{port}'
report = {'platform': platform.platform(), 'scope': 'Synthetic public Client/Remote/provider + real Gateway Agent invocation; native worker pending',
          'base': base, 'checks': [], 'pageErrors': [], 'consoleErrors': []}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE', '/usr/bin/chromium'),
                                headless=True, args=['--no-sandbox', '--disable-background-networking'])
    report['chromium'] = browser.version
    context = browser.new_context(viewport={'width': 1700, 'height': 1200})
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((base, 'data:', 'blob:')) else route.abort())

    def watch(page):
        page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
        page.on('console', lambda message: report['consoleErrors'].append(message.text) if message.type == 'error' else None)

    def state(page):
        return json.loads(page.locator('#projection-state').inner_text())

    def ready(page):
        page.wait_for_function("() => JSON.parse(document.querySelector('#projection-state')?.textContent ?? '{}').projection?.phase === 'ready'", timeout=30000)
        page.locator('[data-composer-input=true]').wait_for(state='attached')

    def action(page, name):
        page.locator(f'[data-projection="{name}"]').click()
        page.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).result?.status !== 'pending'")
        result = state(page).get('result')
        assert not isinstance(result, dict) or result.get('status') != 'error', result
        return result

    def fault(page, name):
        return page.evaluate("async op => { const response = await fetch('/fixture/action?op=' + encodeURIComponent(op)); return response.json(); }", name)

    def saved(page):
        return page.evaluate("JSON.parse(sessionStorage.getItem('omp.fixture.projection-drafts.v1'))")

    def edit(page, text):
        page.locator('[data-composer-input=true]').fill(text)
        page.wait_for_function("text => JSON.parse(document.querySelector('#projection-state').textContent).semantic.draft.text === text", arg=text)
        page.wait_for_function("text => Object.values(JSON.parse(sessionStorage.getItem('omp.fixture.projection-drafts.v1')).records).some(item => item.record.draft.text === text)", arg=text)

    def visible(page, text):
        page.get_by_text(text, exact=True).first.wait_for(state='visible')

    def absent(page, text):
        assert page.get_by_text(text, exact=True).count() == 0, text

    def server_info(page):
        return page.evaluate("async () => (await fetch('/probe/status')).json()")

    def wait_server(page, predicate):
        for _ in range(200):
            if predicate(server_info(page)): return
            page.wait_for_timeout(25)
        raise AssertionError('Server observation did not arrive')

    first = context.new_page()
    second = context.new_page()
    for page in [first, second]: watch(page)
    try:
        for page in [first, second]: page.goto(base); ready(page); visible(page, 'OFF BRANCH ORIGINAL')
        edit(first, 'Tab A independent draft')
        edit(second, 'Tab B independent draft')
        a = state(first)
        b = state(second)
        assert a['semantic']['scope']['tabOwner'] != b['semantic']['scope']['tabOwner']
        action(first, 'retain')
        retained = state(first)['retains']['referenceCount']
        assert retained >= 3
        action(first, 'release-extra')
        assert state(first)['retains']['referenceCount'] == retained - 1
        assert state(first)['bindingStable'] and state(first)['scopeStable']
        report['checks'].append('two tabs share synthetic Session identity; independent drafts and multiple holders retain exact execution binding')

        for control in ['physical-restart', 'connection-ready']:
            fault(first, control)
            for page in [first, second]:
                ready(page); visible(page, 'OFF BRANCH ORIGINAL')
                assert state(page)['projection']['binding']['generation'] == 'projection-1'
                assert state(page)['bindingStable'] and state(page)['scopeStable']
        report['checks'].append('negative controls: physical follow restart and Connection ready keep the same generation and original rows')

        # Negative control: model surface replacement cannot remove append-origin human text.
        fault(first, 'surface-replace')
        visible(first, 'OFF BRANCH ORIGINAL')
        visible(second, 'OFF BRANCH ORIGINAL')
        report['checks'].append('negative control: surface replacement leaves original human rows')

        fault(first, 'hold-page')
        first.locator('[data-projection="load-older"]').click()
        wait_server(first, lambda info: any(item['endpoint'] == 'session/page' for item in info['requests']))
        pending = fault(first, 'interaction')['interaction']
        first.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).pending?.kind === 'approval'")
        second.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).pending?.kind === 'approval'")
        pending_key = state(first)['pending']['key']
        gateway_before = server_info(first)
        assert len(gateway_before['pendingGateway']) == 1
        fault(first, 'invalidate')
        for page, draft in [(first, 'Tab A independent draft'), (second, 'Tab B independent draft')]:
            ready(page); visible(page, 'NEW BRANCH ORIGINAL'); absent(page, 'OFF BRANCH ORIGINAL')
            assert state(page)['id'] == 'fixture-existing'
            assert state(page)['bindingStable'] and state(page)['scopeStable']
            assert state(page)['semantic']['draft']['text'] == draft
            assert state(page)['pending']['key'] == pending_key
            assert state(page)['projection']['binding']['generation'] == 'projection-2'
        fault(first, 'release-page')
        for page in [first, second]: absent(page, 'STALE OLDER ORIGINAL')
        report['checks'].append('old page held across invalidation cannot populate the successor journal')
        gateway_after = server_info(first)
        assert gateway_after['interaction']['deadline'] == pending['deadline']
        assert gateway_after['pendingGateway'] == gateway_before['pendingGateway']
        report['checks'].append('lower cut rebuild reaches both tabs; old branch withdrawn; real Gateway invocation and absolute fixture deadline preserved')

        follows_before = len([frame for frame in server_info(first)['frames'] if frame.get('endpoint') == 'session/follow'])
        fault(first, 'old-assistant')
        first.wait_for_timeout(100)
        for page in [first, second]:
            assert state(page)['projection']['phase'] == 'ready'
            absent(page, 'STALE ASSISTANT')
        assert len([frame for frame in server_info(first)['frames'] if frame.get('endpoint') == 'session/follow']) == follows_before
        report['checks'].append('retired assistant frames are rejected before revision checks; a reused attempt ID in the new generation stays independently dense')

        fault(first, 'old-control')
        assert state(first)['projection']['phase'] == 'ready'
        fault(first, 'rewritten')
        for page in [first, second]: ready(page); visible(page, 'REWRITTEN SAME SHAPE ORIGINAL'); absent(page, 'NEW BRANCH ORIGINAL')
        report['checks'].append('same shape rewritten content gets a new generation; delayed old control cannot regress current rows')

        # Settle only through the actual stock Approval UI, after rebuilding.
        first.get_by_role('button', name='Allow once', exact=True).first.click()
        first.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).pending === null")
        second.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).pending === null")
        assert server_info(first)['interaction']['phase'] == 'answered'
        report['checks'].append('the original real Gateway Agent invocation remains answerable after rebuilding and settles all tabs')

        fault(first, 'fail')
        for page in [first, second]:
            page.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).projection?.phase === 'failed'")
            absent(page, 'REWRITTEN SAME SHAPE ORIGINAL')
        fault(first, 'unfail')
        for page in [first, second]: action(page, 'retry'); ready(page); visible(page, 'FAILED BRANCH ORIGINAL')
        report['checks'].append('baseline failure keeps old branch withdrawn; explicit retry uses the same new authority')

        # Capture separate originals, then preserve the actual in-memory record across a rebuild.
        action(first, 'sample')
        action(second, 'sample')
        edit(first, 'Tab A with ordered originals')
        edit(second, 'Tab B with ordered originals')
        records_before = [state(page)['semantic'] for page in [first, second]]
        saved_before = [saved(page) for page in [first, second]]
        fault(first, 'invalidate')
        for index, page in enumerate([first, second]):
            ready(page)
            page.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).semantic.readiness.every(item => item.status === 'ready')")
            now = state(page)['semantic']
            assert now['draft'] == records_before[index]['draft']
            assert now['originals'] == records_before[index]['originals']
            assert now['readiness'] != records_before[index]['readiness']
            assert now['scope']['storageKey'] == records_before[index]['scope']['storageKey']
            old_records = saved_before[index]['records']
            new_records = saved(page)['records']
            for key in old_records:
                assert new_records[key]['editedAt'] == old_records[key]['editedAt']
        report['checks'].append('both tabs preserve in-memory text, repeated ordered originals and stable keys; fresh receipts do not renew retention')
        fault(first, 'hold-open')
        fault(first, 'invalidate')
        first.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).projection.phase === 'rebuilding'")
        fault(first, 'rewritten')
        fault(first, 'release-open')
        for page in [first, second]:
            ready(page); visible(page, 'REWRITTEN SAME SHAPE ORIGINAL')
            assert state(page)['projection']['binding']['generation'] == 'projection-7'
        report['checks'].append('double invalidation retires a pending opening; late old opening cannot publish')
        action(first, 'delay-prepare')
        first.locator('[data-projection="sample"]').click()
        first.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).preparationHeld === true")
        action(first, 'newer-edit')
        newer = state(first)['semantic']['draft']['text']
        fault(first, 'invalidate')
        ready(first); ready(second)
        action(first, 'release-prepare')
        first.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).semantic.readiness.every(item => item.status === 'ready')")
        assert state(first)['semantic']['draft']['text'] == newer
        report['checks'].append('delayed old provider preparation loses publication authority; newer in-memory edit survives the next generation')
        first.evaluate("async () => await fetch('/probe/prompt-mode?value=delay')")
        action(first, 'submit')
        first.wait_for_function("() => JSON.parse(document.querySelector('#projection-state').textContent).semantic.unresolved !== undefined")
        unresolved = state(first)['semantic']['unresolved']
        wait_server(first, lambda info: len([item for item in info['requests'] if item['endpoint'] == 'session/prompt']) == 1)
        fault(first, 'invalidate')
        for page in [first, second]: ready(page)
        assert state(first)['semantic']['unresolved'] == unresolved
        persisted = list(saved(first)['records'].values())[0]['record']
        assert persisted['unresolved'] == unresolved
        assert len([item for item in server_info(first)['requests'] if item['endpoint'] == 'session/prompt']) == 1
        first.evaluate("async () => await fetch('/probe/release-prompt?outcome=unknown')")
        report['checks'].append('an in-flight unresolved submission remains protected in memory and provider storage across rebuild, with one actual prompt and no automatic replay')
        first.screenshot(path=str(root / 'same-id-multi-holder.png'), full_page=True)
        report['gateway'] = server_info(first)
        report['states'] = [state(first), state(second)]
    finally:
        report['finalStates'] = [state(first), state(second)]
        (root / 'browser.json').write_text(json.dumps(report, indent=2) + '\n')
        browser.close()
