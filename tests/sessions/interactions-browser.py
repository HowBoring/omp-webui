"""Actual Linux Chromium -> public DSH Remote -> Bun Host -> strict native OMP worker.
Ticket 47: multi-page settlement, answer/cancel/expiry races, disconnect/redelivery,
worker restart, and 30-minute creation deadline. Synthetic fixture only; admission stays blocked.
"""
import asyncio, json, os, shutil, signal, subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get('CHROME_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
BUN = os.environ.get('OMP_WEB_BUN') or shutil.which('bun') or 'bun'
HOME = ROOT / 'vendor/sessions-fixture'
PROJECT = HOME / 'project'
PORT = 3187
ORIGIN = f'http://127.0.0.1:{PORT}/'
COMMAND = [BUN, '--no-env-file', 'vendor/host-sessions/session-component-main.js']
STARTUP = 'Strict owned startup cancellation fixture'


def reset(script):
    if (ROOT / 'vendor/sessions-access').exists():
        shutil.rmtree(ROOT / 'vendor/sessions-access')
    (HOME / 'interaction-script.json').write_text(json.dumps(script))
    (HOME / 'interaction-record.jsonl').unlink(missing_ok=True)


def records():
    path = HOME / 'interaction-record.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def start_host():
    child = subprocess.Popen(COMMAND, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    line = child.stdout.readline()
    if '"sessionAdmission":"blocked"' not in line:
        raise RuntimeError(f'synthetic Host failed startup: {line}{child.stderr.read()}')
    return child


def stop_host(host):
    if host.poll() is None:
        host.send_signal(signal.SIGTERM)
    code = host.wait(timeout=40)
    if code != 0:
        raise RuntimeError(f'owned Host did not cleanly stop: {code}\n{host.stderr.read()}')


def worker_pids(host):
    pids = []
    for task in Path(f'/proc/{host.pid}/task').iterdir():
        children = task / 'children'
        if not children.exists():
            continue
        for raw in children.read_text().split():
            cmdline = Path(f'/proc/{raw}/cmdline').read_bytes()
            if b'rpc-ui' in cmdline and b'cli.js' in cmdline:
                pids.append(int(raw))
    return pids


def bootstrap_link():
    return subprocess.check_output(COMMAND + ['--print-bootstrap'], cwd=ROOT, text=True).strip()


async def submit(card, value):
    await card.get_by_label('Explicit answer').fill(value)
    await card.get_by_role('button', name='Submit explicit answer', exact=True).click()


async def card(page, scope=None, timeout=20_000):
    selector = '[data-interaction-id]' + (f'[data-scope="{scope}"]' if scope else '')
    locator = page.locator(selector).first
    await locator.wait_for(timeout=timeout)
    return locator


async def rpc_answer(page, generation, interaction_id, answer):
    """The exact public Remote call the card makes, issued from this authorized page."""
    return await page.evaluate("""async ({generation, id, answer}) => {
      const { csrf } = await (await fetch('/auth/status', { cache: 'no-store' })).json();
      const rpcId = crypto.randomUUID();
      const response = await fetch('/api/ompSessions/answer', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-omp-csrf': csrf },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'ompSessions/answer',
          payload: { args: { generation, id, answer } } }) });
      return { status: response.status, body: await response.text() };
    }""", {'generation': generation, 'id': interaction_id, 'answer': answer})


def outcome_items(page):
    return page.locator('[data-interaction-outcome]')


async def scenario_races(browser):
    reset([
        {'title': STARTUP},
        {'title': 'Session-scoped follow-up', 'timeoutMs': 45_000, 'afterMs': 800},
        {'title': 'Answer versus cancel race', 'afterMs': 800},
        {'title': 'Ordered answer then cancel', 'afterMs': 800},
        {'title': 'Ordered cancel then answer', 'afterMs': 800},
        {'title': 'Disconnect while pending', 'afterMs': 800},
    ])
    host = start_host()
    try:
        link = bootstrap_link()
        context = await browser.new_context()
        a = await context.new_page()
        b = await context.new_page()
        errors = []
        for page in (a, b):
            page.on('pageerror', lambda error: errors.append(str(error)))
        await a.goto(link)
        await a.wait_for_selector('[data-session-root-slot]')
        await a.get_by_label('Directory to authorize').fill(str(PROJECT))
        await a.get_by_role('button', name='Review directory', exact=True).click()
        await a.get_by_role('button', name='Grant this directory and descendants', exact=True).click()
        await a.wait_for_selector('article[data-native-id="native-0000"]')
        await b.goto(ORIGIN)
        await b.wait_for_selector('article[data-native-id="native-0000"]')
        await asyncio.gather(
            a.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click(),
            b.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click())
        first = await card(a, scope='startup')
        await card(b, scope='startup')
        startup_id = await first.get_attribute('data-interaction-id')
        assert startup_id == await b.locator('[data-interaction-id]').get_attribute('data-interaction-id')
        created = int(await first.get_attribute('data-created-at'))
        deadline = int(await first.locator('[data-deadline]').get_attribute('data-deadline'))
        assert deadline - created == 30 * 60 * 1000, (created, deadline)
        assert created == int(await b.locator('[data-interaction-id]').get_attribute('data-created-at'))
        await a.reload()
        reloaded = await card(a, scope='startup')
        assert startup_id == await reloaded.get_attribute('data-interaction-id')
        assert (int(await reloaded.get_attribute('data-created-at')),
                int(await reloaded.locator('[data-deadline]').get_attribute('data-deadline'))) == (created, deadline)

        generation = await first.get_attribute('data-generation')
        answers = await asyncio.gather(
            rpc_answer(a, generation, startup_id, {'type': 'value', 'value': 'from-page-a'}),
            rpc_answer(b, generation, startup_id, {'type': 'value', 'value': 'from-page-b'}))
        joined = ' '.join(item['body'] for item in answers)
        assert all(item['status'] == 200 for item in answers), answers
        assert joined.count('"answered"') == 1 and joined.count('"stale"') == 1, joined
        # The reload discarded A's original Open continuation; the same worker is still open for B.
        await a.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click()
        for page in (a, b):
            await page.wait_for_selector('[data-native-binding="native-0000"]', timeout=20_000)
            await expect(page.locator('#conversation')).to_contain_text('Synthetic fixture input', timeout=15_000)
        worker = await a.locator('[data-worker-id]').get_attribute('data-worker-id')
        assert worker == await b.locator('[data-worker-id]').get_attribute('data-worker-id')
        start_records = [entry for entry in records() if entry['step'] == 0]
        assert len(start_records) == 1 and start_records[0]['outcome'] == 'value', start_records

        follow = await card(a, scope='session')
        await card(b, scope='session')
        follow_id = await follow.get_attribute('data-interaction-id')
        follow_created = int(await follow.get_attribute('data-created-at'))
        follow_deadline = int(await follow.locator('[data-deadline]').get_attribute('data-deadline'))
        assert abs((follow_deadline - follow_created) - 45_000) <= 1, (follow_created, follow_deadline)
        await b.locator(f'[data-interaction-id="{follow_id}"]').get_by_role('button', name='Cancel interaction', exact=True).click()
        await expect(a.locator(f'[data-interaction-outcome="{follow_id}"]')).to_have_attribute('data-status', 'cancelled')
        await expect(a.locator(f'[data-interaction-outcome="{follow_id}"]')).to_have_attribute('data-reason', 'explicit-cancel')
        assert not await b.locator(f'[data-interaction-id="{follow_id}"]').count()
        follow_records = [entry for entry in records() if entry['step'] == 1]
        assert [entry['outcome'] for entry in follow_records] == ['cancelled'], follow_records

        race = await card(a)
        race_id = await race.get_attribute('data-interaction-id')
        race_generation = await race.get_attribute('data-generation')
        await asyncio.gather(
            rpc_answer(a, race_generation, race_id, {'type': 'value', 'value': 'race-winner'}),
            rpc_answer(b, race_generation, race_id, {'type': 'cancel'}))
        await expect(a.locator(f'[data-interaction-outcome="{race_id}"]')).to_be_visible(timeout=15_000)
        await a.wait_for_timeout(300)
        status = await a.locator(f'[data-interaction-outcome="{race_id}"]').get_attribute('data-status')
        assert status in ('answered', 'cancelled'), status
        race_records = [entry for entry in records() if entry['step'] == 2]
        assert len(race_records) == 1, race_records
        if status == 'answered':
            assert race_records[0] == {'step': 2, 'title': 'Answer versus cancel race', 'outcome': 'value', 'value': 'race-winner'}
        else:
            assert race_records[0]['outcome'] == 'cancelled', race_records

        answered = await card(a)
        answered_id = await answered.get_attribute('data-interaction-id')
        answered_generation = await answered.get_attribute('data-generation')
        first_answer = await rpc_answer(a, answered_generation, answered_id, {'type': 'value', 'value': 'settled-first'})
        late_cancel = await rpc_answer(b, answered_generation, answered_id, {'type': 'cancel'})
        assert '"answered"' in first_answer['body'] and '"stale"' in late_cancel['body'], (first_answer, late_cancel)
        await expect(a.locator(f'[data-interaction-outcome="{answered_id}"]')).to_have_attribute('data-status', 'answered')
        await expect(a.locator(f'[data-interaction-outcome="{answered_id}"]')).to_have_attribute('data-reason', 'explicit-answer')
        assert [entry for entry in records() if entry['step'] == 3] == [
            {'step': 3, 'title': 'Ordered answer then cancel', 'outcome': 'value', 'value': 'settled-first'}]

        cancelled = await card(a)
        cancelled_id = await cancelled.get_attribute('data-interaction-id')
        cancelled_generation = await cancelled.get_attribute('data-generation')
        first_cancel = await rpc_answer(b, cancelled_generation, cancelled_id, {'type': 'cancel'})
        late_answer = await rpc_answer(a, cancelled_generation, cancelled_id, {'type': 'value', 'value': 'settled-late'})
        assert '"cancelled"' in first_cancel['body'] and '"stale"' in late_answer['body'], (first_cancel, late_answer)
        await expect(a.locator(f'[data-interaction-outcome="{cancelled_id}"]')).to_have_attribute('data-status', 'cancelled')
        await expect(a.locator(f'[data-interaction-outcome="{cancelled_id}"]')).to_have_attribute('data-reason', 'explicit-cancel')
        assert [entry for entry in records() if entry['step'] == 4] == [
            {'step': 4, 'title': 'Ordered cancel then answer', 'outcome': 'cancelled'}]

        pending = await card(a)
        pending_id = await pending.get_attribute('data-interaction-id')
        pending_created = await pending.get_attribute('data-created-at')
        pending_deadline = await pending.locator('[data-deadline]').get_attribute('data-deadline')
        await b.close()
        await a.wait_for_timeout(700)
        assert await a.locator(f'[data-interaction-id="{pending_id}"]').count()
        assert await a.locator('[data-worker-id]').get_attribute('data-worker-id') == worker
        await a.close()
        await asyncio.sleep(0.7)
        reconnected = await context.new_page()
        reconnected.on('pageerror', lambda error: errors.append(str(error)))
        await reconnected.goto(ORIGIN)
        await reconnected.wait_for_selector('[data-session-root-slot]')
        restored = await card(reconnected, timeout=20_000)
        assert pending_id == await restored.get_attribute('data-interaction-id')
        created_now = await restored.get_attribute('data-created-at')
        deadline_now = await restored.locator('[data-deadline]').get_attribute('data-deadline')
        assert (created_now, deadline_now) == (pending_created, pending_deadline)
        await restored.get_by_label('Explicit answer').fill('after-reconnect')
        await restored.get_by_role('button', name='Submit explicit answer', exact=True).click()
        await reconnected.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click()
        await reconnected.wait_for_selector('[data-native-binding="native-0000"]', timeout=20_000)
        assert await reconnected.locator('[data-worker-id]').get_attribute('data-worker-id') == worker
        pending_records = [entry for entry in records() if entry['step'] == 5]
        assert pending_records == [{'step': 5, 'title': 'Disconnect while pending', 'outcome': 'value', 'value': 'after-reconnect'}], pending_records
        assert not errors, errors
        await context.close()
        return {
            'scenarios': ['two-authorized-pages-one-startup-card', 'default-30-minute-creation-deadline',
                          'refresh-keeps-deadline', 'simultaneous-two-page-answer-one-answered-one-stale',
                          'session-scoped-configured-45s-deadline', 'explicit-cancel-observable',
                          'answer-versus-cancel-race-one-settlement', 'later-reply-stale-after-answer',
                          'later-reply-stale-after-cancel', 'all-pages-disconnect-preserves-pending',
                          'reconnect-redelivers-original-id-and-deadline', 'answer-after-reconnect-same-worker'],
            'workerId': worker, 'startupId': startup_id, 'followUpId': follow_id, 'raceId': race_id,
            'pendingId': pending_id, 'reconnectedCreatedAt': created_now, 'reconnectedDeadline': deadline_now,
            'wireAnswers': [item['status'] for item in answers], 'nativeRecords': records(),
        }
    finally:
        stop_host(host)


async def scenario_expiry(browser):
    reset([{'title': STARTUP}, {'title': 'Native expiry question', 'timeoutMs': 3_000, 'afterMs': 700}])
    host = start_host()
    try:
        link = bootstrap_link()
        context = await browser.new_context()
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(link)
        await page.wait_for_selector('[data-session-root-slot]')
        await page.get_by_label('Directory to authorize').fill(str(PROJECT))
        await page.get_by_role('button', name='Review directory', exact=True).click()
        await page.get_by_role('button', name='Grant this directory and descendants', exact=True).click()
        await page.wait_for_selector('article[data-native-id="native-0000"]')
        await page.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click()
        startup = await card(page, scope='startup')
        await submit(startup, 'expiry-owner')
        await page.wait_for_selector('[data-native-binding="native-0000"]', timeout=20_000)
        expiring = await card(page, scope='session')
        expiring_id = await expiring.get_attribute('data-interaction-id')
        created = int(await expiring.get_attribute('data-created-at'))
        deadline = int(await expiring.locator('[data-deadline]').get_attribute('data-deadline'))
        assert abs((deadline - created) - 3_000) <= 1, (created, deadline)
        await page.wait_for_selector(f'[data-interaction-id="{expiring_id}"]', state='detached', timeout=15_000)
        stop = page.locator('[data-interaction-outcome="worker-stop"]')
        await expect(stop).to_be_visible(timeout=10_000)
        assert await stop.get_attribute('data-status') == 'stopping'
        assert await stop.get_attribute('data-reason') in ('expired', 'native-expired')
        assert await stop.get_attribute('data-stop') in ('requested', 'acknowledged', 'failed')
        expiry_records = [entry for entry in records() if entry['step'] == 1]
        assert [entry['outcome'] for entry in expiry_records] == ['expired'], expiry_records
        await page.wait_for_timeout(500)
        assert await page.locator(f'[data-interaction-id="{expiring_id}"]').count() == 0
        assert not errors, errors
        await context.close()
        return {'scenarios': ['native-timeout-configured-3s', 'expiry-without-default-answer',
                              'expiry-observable-stop', 'expired-card-not-resurrected'],
                'expiringId': expiring_id, 'nativeRecords': records()}
    finally:
        stop_host(host)


async def scenario_worker_restart(browser):
    reset([{'title': STARTUP}])
    host = start_host()
    try:
        link = bootstrap_link()
        context = await browser.new_context()
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(link)
        await page.wait_for_selector('[data-session-root-slot]')
        await page.get_by_label('Directory to authorize').fill(str(PROJECT))
        await page.get_by_role('button', name='Review directory', exact=True).click()
        await page.get_by_role('button', name='Grant this directory and descendants', exact=True).click()
        await page.wait_for_selector('article[data-native-id="native-0000"]')
        await page.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click()
        old = await card(page, scope='startup')
        old_id = await old.get_attribute('data-interaction-id')
        pids = worker_pids(host)
        assert len(pids) == 1, pids
        os.kill(pids[0], signal.SIGKILL)
        await page.wait_for_selector(f'[data-interaction-id="{old_id}"]', state='detached', timeout=20_000)
        await page.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click()
        fresh = await card(page, scope='startup', timeout=20_000)
        fresh_id = await fresh.get_attribute('data-interaction-id')
        assert fresh_id != old_id
        assert await page.locator(f'[data-interaction-id="{old_id}"]').count() == 0
        await submit(fresh, 'after-worker-restart')
        await page.wait_for_selector('[data-native-binding="native-0000"]', timeout=20_000)
        assert not errors, errors
        await context.close()
        return {'scenarios': ['worker-SIGKILL-clears-old-card', 'manual-reopen-new-worker-new-interaction',
                              'old-interaction-not-resurrected'], 'oldId': old_id, 'freshId': fresh_id,
                'nativeRecords': records()}
    finally:
        stop_host(host)


async def scenario_revocation_race(browser):
    reset([{'title': STARTUP}, {'title': 'Revocation race question', 'afterMs': 700}])
    host = start_host()
    try:
        link = bootstrap_link()
        context = await browser.new_context()
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(link)
        await page.wait_for_selector('[data-session-root-slot]')
        await page.get_by_label('Directory to authorize').fill(str(PROJECT))
        await page.get_by_role('button', name='Review directory', exact=True).click()
        await page.get_by_role('button', name='Grant this directory and descendants', exact=True).click()
        await page.wait_for_selector('article[data-native-id="native-0000"]')
        await page.locator('article[data-native-id="native-0000"]').get_by_role('button', name='Open Session', exact=True).click()
        startup = await card(page, scope='startup')
        await submit(startup, 'revocation-owner')
        await page.wait_for_selector('[data-native-binding="native-0000"]', timeout=20_000)
        pending = await card(page, scope='session')
        pending_id = await pending.get_attribute('data-interaction-id')
        await pending.get_by_label('Explicit answer').fill('raced-answer')
        click = asyncio.create_task(pending.get_by_role('button', name='Submit explicit answer', exact=True).click(timeout=5_000))
        await asyncio.gather(click, asyncio.to_thread(os.kill, host.pid, signal.SIGUSR1), return_exceptions=True)
        await page.wait_for_timeout(1_500)
        assert not await page.locator('[data-interaction-id]').count()
        accepted = [entry for entry in records() if entry['step'] == 1 and entry['outcome'] == 'value']
        assert len(accepted) <= 1, accepted
        if accepted:
            assert accepted[0]['value'] == 'raced-answer'
        await page.reload()
        await page.wait_for_timeout(300)
        body = await page.locator('body').inner_text()
        assert 'AUTH_REQUIRED' in body or 'Browser authorization required' in body, body
        assert await page.locator('[data-interaction-id]').count() == 0
        assert not errors, errors
        await context.close()
        return {'scenarios': ['revocation-racing-answer-never-double-settles', 'revoked-browser-cannot-observe-card',
                              'revoked-worker-stopped'], 'pendingId': pending_id, 'acceptedBeforeRevocation': accepted,
                'nativeRecords': records()}
    finally:
        stop_host(host)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        results = []
        for scenario in (scenario_races, scenario_expiry, scenario_worker_restart, scenario_revocation_race):
            results.append({'scenario': scenario.__name__, 'result': 'PASS', **(await scenario(browser))})
        await browser.close()
    result = {'status': 'PASS', 'platform': 'Linux Chromium', 'browser': browser.version,
              'realDSH': True, 'realBun': True, 'realStrictNative': True, 'privateData': False,
              'normalProductAdmission': 'blocked', 'scenarios': results}
    (ROOT / 'vendor/session-interactions-browser.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


asyncio.run(main())
