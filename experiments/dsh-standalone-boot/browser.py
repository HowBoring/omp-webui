"""Chromium boot probe. Does not create Sessions, submit prompts, or use real user data."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

evidence = Path(sys.argv[1]).resolve()
port = json.loads((evidence / 'server.json').read_text())['port']
base = f'http://127.0.0.1:{port}'
report = {'bare': {}, 'ordinary': {}, 'injected': {}}
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('DSH_PROBE_CHROMIUM', '/usr/bin/chromium'),
        headless=True, args=['--no-sandbox'],
    )
    report['chromium'] = browser.version
    bare = browser.new_page()
    bare.goto(base + '/bare')
    bare.get_by_text('web boot: window.__ModuleLoader__ bootstrap facade is missing', exact=False).wait_for()
    report['bare']['missing_facade_detected'] = True
    bare.close()
    ordinary = browser.new_page()
    ordinary_errors = []
    ordinary.on('pageerror', lambda error: ordinary_errors.append(str(error)))
    ordinary.goto(base)
    ordinary.get_by_text('New Session', exact=True).wait_for()
    ordinary.wait_for_timeout(1500)
    report['ordinary'] = {'body': ordinary.locator('body').inner_text(), 'errors': ordinary_errors}
    ordinary.close()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors, console, failed, http_errors, resources = [], [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda item: console.append({'type': item.type, 'text': item.text}))
    page.on('requestfailed', lambda request: failed.append({'url': request.url, 'failure': request.failure}))
    page.on('response', lambda response: http_errors.append({'url': response.url, 'status': response.status})
            if response.status >= 400 else None)
    page.on('response', lambda response: resources.append({
        'url': response.url, 'status': response.status, 'content_type': response.headers.get('content-type'),
    }))
    page.goto(base + '/?observe=1')
    try:
        page.wait_for_function("""() => {
          const loader = window.__BOOT_PROBE_LOADER__;
          return loader && [...loader.entries()].length === 28
            && [...loader.entries()].every(entry => entry.fiber?.state === 2);
        }""", timeout=20000)
    except Exception as error:
        report['injected']['activation_wait'] = str(error).splitlines()[0]
    # Give async opening reads/streams time to settle before sampling their observable result.
    page.wait_for_timeout(1500)
    report['injected'].update(page.evaluate("""() => ({
      entries: [...(window.__BOOT_PROBE_LOADER__?.entries() ?? [])].map(entry => ({
        name: entry.options.name, state: entry.fiber?.state,
        missing: Object.keys(entry.fiber?.inject ?? {}).filter(key =>
          window.__BOOT_PROBE_LOADER__.ctx.get(key) === undefined),
      })),
      body: document.body.innerText,
      buttons: document.querySelectorAll('button').length,
      scripts: [...document.scripts].map(script => script.src).filter(Boolean),
    })"""))
    report['injected'].update(errors=errors, console=console, failed_requests=failed,
                             http_errors=http_errors, resources=resources)
    page.screenshot(path=str(evidence / 'injected.png'), full_page=True)
    (evidence / 'injected.html').write_text(page.content())
    report['host'] = page.request.get(base + '/probe/status').json()
    report['unknown_plugin_status'] = page.request.get(base + '/plugins/missing/client.js').status
    page.close()
    browser.close()
(evidence / 'browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
assert len(report['injected']['entries']) == 28
assert all(entry['state'] == 2 for entry in report['injected']['entries'])
assert report['injected']['buttons'] > 0
assert not report['ordinary']['errors']
assert not errors and not failed and not http_errors
assert not [item for item in console if item['type'] == 'error']
assert report['unknown_plugin_status'] == 404
assert {'settings/describe', 'session/list'}.issubset(
    {item['endpoint'] for item in report['host']['requests']})
assert {'$events', 'remoteAccess/follow', 'workspace/follow', 'session/control'}.issubset(
    {item['endpoint'] for item in report['host']['frames'] if item['type'] == 'open'})
