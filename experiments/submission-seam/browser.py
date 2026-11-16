"""Actual Linux Chromium, stock DSH Client/provider/Remote, Bun, and public native worker. Synthetic data only."""
import json
import os
import platform
import sys
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(sys.argv[1])
port = json.loads((root / 'server.json').read_text())['port']
base = f'http://127.0.0.1:{port}'
report = {'kind': 'isolated-native-submission-component', 'platform': platform.platform(), 'checks': [], 'pageErrors': []}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    report['chromium'] = browser.version
    page = browser.new_page(viewport={'width': 1500, 'height': 1100})
    page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
    def state(): return json.loads(page.locator('#draft-state').inner_text())
    def ready(): page.wait_for_function("JSON.parse(document.querySelector('#draft-state')?.textContent ?? '{}').ready === true")
    def action(name):
        page.locator(f'[data-draft={name}]').click()
        page.wait_for_function("JSON.parse(document.querySelector('#draft-state').textContent).result?.status !== 'pending'")
        assert state()['result'].get('status') != 'error', state()
    try:
        page.goto(base)
        ready()
        action('open-a')
        page.locator('[data-composer-input=true]').fill('Literal browser native submission')
        page.locator('[data-composer-input=true]').press('Enter')
        page.wait_for_function("JSON.parse(document.querySelector('#draft-state').textContent).semantic.unresolved !== undefined")
        marker = state()['semantic']['unresolved']['id']
        for attempt in range(200):
            before = page.evaluate("async id => (await fetch('/fixture/native-query?id='+encodeURIComponent(id))).json()", marker)
            if before['terminal'] and before['persistence'] == 'committed': break
            if attempt == 199: raise AssertionError(before)
            page.wait_for_timeout(25)
        assert before['inputOutcome'] == 'generated' and any(r['role'] == 'input' and r['persistence'] == 'committed' for r in before['relations']), before
        report['checks'].append('public DSH beforeDispatch correlates its exact request identity and durable local marker to native reservation and committed input')
        page.reload()
        ready()
        action('open-a')
        assert state()['semantic']['unresolved']['id'] == marker, state()
        assert state()['semantic']['phase'] == 'sending', state()
        report['checks'].append('lost Remote response plus reload preserves the original unresolved marker and frozen draft without automatic new input')
        action('restart-worker')
        recovered = page.evaluate("async id => (await fetch('/fixture/native-query?id='+encodeURIComponent(id))).json()", marker)
        assert recovered['origin'] == before['origin'] and recovered['relations'] == before['relations'], recovered
        action('recover')
        assert state()['semantic'].get('unresolved') is None, state()
        assert state()['semantic']['draft']['text'] == '', state()
        report['checks'].append('explicit read-only native query after actual worker restart resolves accepted input without replay')
        report['native'] = recovered
        report['marker'] = marker
        page.screenshot(path=str(root / 'native-submission.png'))
    finally:
        (root / 'browser.json').write_text(json.dumps(report, indent=2)+'\n')
        browser.close()
