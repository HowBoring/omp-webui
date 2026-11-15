"""Real Chromium over public DSH module/Connection APIs and isolated fixture data only."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(sys.argv[1]).resolve()
mode = sys.argv[2]
evidence = root / mode
port = json.loads((evidence / 'server.json').read_text())['port']
base = f'http://127.0.0.1:{port}'
report = {'mode': mode, 'checks': [], 'errors': [], 'console_errors': []}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    report['chromium'] = browser.version
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    # Exercise a supported DSH Web shortcut profile on real Chromium; this is not Windows OS/hardware certification.
    context.add_init_script("Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })")
    report['browser_platform_profile'] = 'Win32 (emulated navigator platform on Linux Chromium)'
    page = context.new_page()
    def capture(target):
        target.on('pageerror', lambda error: report['errors'].append(str(error)))
        target.on('console', lambda msg: report['console_errors'].append(msg.text) if msg.type == 'error' else None)
    capture(page)
    def ready(target):
        target.wait_for_function("""() => {
          const el = document.querySelector('#probe-state');
          const loader = window.__BOOT_PROBE_LOADER__;
          if (!el || !loader) return false;
          const state = JSON.parse(el.textContent);
          return state.startup && state.generation && state.catalog?.phase === 'ready'
            && [...loader.entries()].length === 30 && [...loader.entries()].every(e => e.fiber.state === 2);
        }""", timeout=20000)
    def state(target=page):
        return json.loads(target.locator('#probe-state').inner_text())
    def status():
        return page.request.get(base + '/probe/status').json()
    def count(endpoint):
        return sum(call['endpoint'] == endpoint for call in status()['requests'])
    def click(name, target=page):
        target.locator(f'[data-probe={name}]').click()
    def wait_result(code=None, target=page):
        target.wait_for_function("""code => {
          const state = JSON.parse(document.querySelector('#probe-state').textContent);
          return code === null ? state.result?.ok === true : state.result?.error?.code === code;
        }""", arg=code)
    def control(action):
        assert page.request.post(base + '/probe/control', data={'action': action}).ok
    try:
        page.goto(base + '/?observe=1')
        ready(page)
        click('bind'); wait_result()
        report['shortcut_preferences'] = state()['result']['value']
        report['initial'] = state()
        report['entries'] = page.evaluate("() => [...window.__BOOT_PROBE_LOADER__.entries()].map(e=>({name:e.options.name,state:e.fiber.state}))")
        page.screenshot(path=str(evidence / 'startup.png'))
        if mode == 'baseline':
            page.wait_for_function("() => document.querySelector('#probe-state').textContent.includes('fixture-created-1')")
            assert count('session/create') >= 1
            assert status()['authorized'] is False and status()['registered'] is False
            # The same provided deployment policy is ignored by unpatched DSH.
            for name in ['authorize', 'register', 'open']:
                click(name); wait_result()
            page.get_by_text('Untitled', exact=True).first.hover()
            page.get_by_role('button', name='Session actions for Untitled', exact=True).click()
            page.get_by_role('menuitem', name='Rename', exact=False).wait_for()
            page.keyboard.press('Escape')
            for name in ['busy', 'queue']:
                click(name); wait_result()
            wait_result()
            assert count('session/prompt') == 1
            page.keyboard.press('Control+Alt+g')
            page.get_by_role('dialog').wait_for()
            report['checks'] += ['automatic creation despite embedding policy', 'unsupported rename remains exposed',
                                 'busy queue admitted', 'rename hotkey remains actionable']
        else:
            assert count('session/create') == 0
            assert state()['catalog']['retained'] == 0
            assert not [f for f in status()['frames'] if f.get('endpoint') == 'session/follow']
            assert state()['startup']['pending']['id'] == 'startup-1'
            # Real persisted stale selection, loaded in a fresh runtime. No private instance mutation.
            page.evaluate("localStorage.setItem('dsh.sessions.current', JSON.stringify({sessionId:'fixture-stale'}))")
            page.reload(); ready(page)
            assert count('session/create') == 0 and state()['catalog']['retained'] == 0
            click('discover'); wait_result()
            click('select')
            page.wait_for_function("() => JSON.parse(document.querySelector('#probe-state').textContent).navigation.intents.some(i=>i.kind==='workspace')")
            assert not status()['authorized'] and not status()['registered'] and count('session/create') == 0
            click('open'); wait_result('fixture/not-authorized-or-registered')
            click('register'); wait_result()
            assert not status()['authorized'] and count('session/create') == 0
            click('authorize'); wait_result()
            click('open'); wait_result()
            page.get_by_text('Untitled', exact=True).first.hover()
            page.get_by_role('button', name='Session actions for Untitled', exact=True).wait_for()
            assert count('session/create') == 0
            report['checks'] += ['startup and stale refresh do not create/retain', 'root startup UI before any history open',
                                 'discovery/selection/registration/authorization/open remain distinct']
            page.get_by_text('Untitled', exact=True).first.hover()
            page.get_by_role('button', name='Session actions for Untitled', exact=True).click()
            page.get_by_role('menuitem', name='Copy Session ID', exact=False).wait_for()
            assert not page.get_by_role('menuitem', name='Rename', exact=False).count()
            assert not page.get_by_role('menuitem', name='Fork', exact=False).count()
            assert not page.get_by_role('menuitem', name='Archive', exact=False).count()
            page.screenshot(path=str(evidence / 'supported-menu.png'))
            page.keyboard.press('Escape')
            page.get_by_text('Untitled', exact=True).first.dblclick()
            assert page.get_by_role('dialog').count() == 0
            for key in ['Control+Alt+g', 'Control+Shift+f', 'Control+Alt+a']:
                page.keyboard.press(key)
            assert page.get_by_role('dialog').count() == 0
            for endpoint in ['session/rename', 'session/fork', 'workspace/archiveSession', 'workspace/pinSession']:
                assert count(endpoint) == 0
            report['checks'].append('menus/double-click/physical hotkeys obey policy with owner=true')
            editor = page.locator('[data-composer-input=true]')
            editor.fill('busy draft must survive')
            click('busy'); wait_result()
            # Public Session verbs reject both delivery modes. The real composer also exercises rejection recovery.
            click('queue'); wait_result('client/session-busy')
            click('steer'); wait_result('client/session-busy')
            editor.press('Enter')
            page.get_by_text('The session is busy.', exact=False).wait_for()
            assert editor.inner_text().strip() == 'busy draft must survive'
            assert count('session/prompt') == 0
            editor.fill('edited while busy')
            click('stop'); wait_result()
            assert count('session/cancel') == 1
            assert editor.inner_text().strip() == 'edited while busy'
            page.screenshot(path=str(evidence / 'busy-draft.png'))
            click('idle'); wait_result()
            editor.press('Enter')
            page.wait_for_function("() => document.querySelector('[data-composer-input=true]').innerText.trim()==='' ")
            assert count('session/prompt') == 1
            report['checks'].append('busy queue/steer/composer reject; draft editable and restored; Stop and idle send work')
            # Two pages share the fixture's explicit owner baseline, without non-owner permission fabrication.
            second = context.new_page(); capture(second)
            second.goto(base + '/?observe=1'); ready(second)
            assert state(second)['startup']['pending'] == state()['startup']['pending']
            click('answer')
            page.wait_for_function("() => JSON.parse(document.querySelector('#probe-state').textContent).startup.pending===null")
            second.wait_for_function("() => JSON.parse(document.querySelector('#probe-state').textContent).startup.pending===null")
            click('stale', second); wait_result('fixture/stale-interaction', second)
            control('renew')
            page.wait_for_function("() => JSON.parse(document.querySelector('#probe-state').textContent).startup.pending!==null")
            control('cancel')
            page.wait_for_function("() => JSON.parse(document.querySelector('#probe-state').textContent).startup.pending===null")
            control('stale')
            click('stale'); wait_result('fixture/stale-interaction')
            assert state()['startup']['pending'] is None
            control('renew')
            page.wait_for_function("() => JSON.parse(document.querySelector('#probe-state').textContent).startup.pending!==null")
            generation = state()['generation']
            control('disconnect')
            page.wait_for_function("g => JSON.parse(document.querySelector('#probe-state').textContent).generation>g", arg=generation)
            ready(page)
            assert state()['startup']['pending'] is not None
            assert count('session/create') == 0
            report['checks'].append('two pages receive root UI; first valid reply wins; cancellation/stale delivery/reconnect are bounded')
            second.close()
            page.get_by_role('button', name='New session', exact=True).last.click()
            page.wait_for_function("() => JSON.parse(document.querySelector('#probe-state').textContent).catalog.ids.includes('fixture-created-1')")
            assert count('session/create') == 1
            assert count('session/prompt') == 1
            report['checks'].append('explicit New creates once and does not send a prompt')
        report['final'] = state()
        report['host'] = status()
        assert not report['errors'], report['errors']
        assert not report['console_errors'], report['console_errors']
        report['passed'] = True
    finally:
        try:
            report['last_body'] = page.locator('body').inner_text()
            report['last_host'] = status()
        except Exception as error:
            report['capture_error'] = str(error)
        (evidence / 'browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        browser.close()
print(json.dumps({'mode': mode, 'passed': report.get('passed', False), 'checks': report['checks']}))
