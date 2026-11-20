"""Actual Linux Chromium -> public DSH prompt -> real Chat Gateway -> strict native worker.

Explicit synthetic S2 fixture; live-provider scenarios are controlled, never real inference.
"""
import asyncio, json, os, re, shutil, signal, socket, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = Path(os.environ.get("OMP_CHAT_HOST_DIR", ROOT / "vendor/host-chat")) / "chat-component-main.js"
PORT = int(os.environ.get("OMP_CHAT_PORT", os.environ.get("OMP_CHAT_FIXTURE_PORT", "3188")))
CHAT_BUTTON = re.compile(r"(Open|Switch) Chat Session")


def kill_worker():
    subprocess.run(["pkill", "-f", re.escape(f"{ROOT}/vendor/omp-candidate/cli.js") + ".*--mode rpc-ui"], check=False)


async def wait_health(timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1)
            return
        except Exception:
            await asyncio.sleep(0.1)
    raise RuntimeError("chat Host did not become healthy")


def port_open():
    with socket.socket() as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(("127.0.0.1", PORT)) == 0


async def start_host(scenario=None, delay=None, tools=None):
    env = os.environ.copy()
    env["OMP_CHAT_PORT"] = str(PORT)
    env["OMP_CHAT_FIXTURE_PORT"] = str(PORT)
    if scenario:
        env["OMP_CHAT_FIXTURE_SCENARIO"] = scenario
    if delay is not None:
        env["OMP_CHAT_FIXTURE_DELAY_MS"] = str(delay)
    if tools:
        env["OMP_CHAT_FIXTURE_TOOLS"] = str(tools)
    # A force-terminated scenario can leave its predecessor draining past the SIGTERM wait. Kill any
    # leftover hard and wait for the port itself to be released: health from a predecessor that still
    # owns the port must never be mistaken for the new host.
    for _ in range(3):
        subprocess.run(["pkill", "-9", "-f", str(HOST)], check=False)
        for _ in range(150):
            if not port_open():
                break
            await asyncio.sleep(0.1)
        host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env,
                                stdout=open(ROOT / "vendor/chat-host.log", "w"), stderr=subprocess.STDOUT)
        try:
            await wait_health()
        except RuntimeError:
            continue
        if host.poll() is None:
            return host
    raise RuntimeError("chat Host did not become healthy on a free port")


def bootstrap():
    env = os.environ.copy()
    env["OMP_CHAT_PORT"] = str(PORT)
    env["OMP_CHAT_FIXTURE_PORT"] = str(PORT)
    return subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"], cwd=ROOT, env=env, text=True).strip()


async def stop_host(host):
    kill_worker()
    if host.poll() is None:
        host.send_signal(signal.SIGTERM)
        try:
            host.wait(timeout=10)
        except subprocess.TimeoutExpired:
            host.kill()
            host.wait(timeout=5)
    await asyncio.sleep(0.5)


async def grant(page):
    await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
    await page.get_by_role("button", name="Review directory", exact=True).click()
    await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
    await page.get_by_role("button", name="Refresh catalog").click()


async def open_session(page, native_id="native-0000"):
    await page.get_by_role("button", name="Refresh catalog").click()
    await page.locator(f'li[data-native-id="{native_id}"]').get_by_role("button", name=CHAT_BUTTON).click()
    try:
        await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=60000)
    except Exception:
        # Catalog reads can race a Host restart; the supported recovery is an explicit refresh and Open.
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator(f'li[data-native-id="{native_id}"]').get_by_role("button", name=CHAT_BUTTON).click()
        await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=60000)


async def wait_draft(page, text):
    try:
        await page.wait_for_function("([text]) => Object.keys(localStorage).some(key => key.startsWith(\"omp.draft.v1:\") && localStorage.getItem(key).includes(text))", arg=[text], timeout=60000)
    except Exception:
        print("DRAFT_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
        print("DRAFT_KEYS", await page.evaluate("() => Object.keys(localStorage)"))
        raise


async def wait_session(page, native_id):
    try:
        await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=60000)
    except Exception:
        print("SESSION_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
        print("SESSION_STATE", await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session"),
              await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id"))
        print("SESSION_BODY", (await page.locator("body").inner_text())[:800])
        raise


async def send(page, text):
    await page.get_by_label("Message").fill(text)
    await wait_draft(page, text)
    await page.wait_for_selector('[data-chat-draft-ready="true"]', state="attached", timeout=60000)
    await page.get_by_role("button", name="Send", exact=True).click()


async def new_page(browser, errors):
    context = await browser.new_context()
    page = await context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: print("CONSOLE", message.type, message.text[:500])
            if message.type in ("error", "warning") else None)

    async def log_response(response):
        if "/api/" in response.url and (response.status >= 400 or response.request.method == "POST"):
            try:
                body = await response.text()
            except Exception:
                body = "<no body>"
            if response.status >= 400 or '"ok":false' in body:
                print("RPC", response.status, response.url.rsplit("/api/", 1)[-1], body[:400].replace("\n", " "))

    page.on("response", log_response)
    await page.goto(bootstrap())
    await page.wait_for_selector("[data-chat-root-slot]")
    return context, page


async def phase_pending_ui(browser, errors, scenarios=None, grant_first=False):
    host = await start_host(scenario="pending-ui", delay=100)
    try:
        context, page = await new_page(browser, errors)
        if grant_first:
            await grant(page)
        await open_session(page)
        await send(page, "pending native question before stop")
        await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
        audit_path = ROOT / "vendor/chat-fixture/pending-ui-audit.json"
        for _ in range(100):
            if audit_path.exists() and json.loads(audit_path.read_text()).get("stage") == "awaiting": break
            await page.wait_for_timeout(100)
        assert audit_path.exists() and json.loads(audit_path.read_text()).get("stage") == "awaiting", \
            "the native question reached the #47 Broker before Stop"
        await page.get_by_role("button", name="Stop", exact=True).click()
        await page.wait_for_selector('[data-chat-stop-status="stopping"]', timeout=10000)
        # The broker cancels the native question; settlement is only shown when the gateway sees every
        # pending interaction at zero, so this wait proves the UI cancellation and joint quiescence.
        await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=30000)
        audit = json.loads(audit_path.read_text())
        assert audit["answer"] == "cancelled", f"native question was cancelled: {audit}"
        if scenarios is not None:
            scenarios.append("pending-ui-cancelled-by-stop")
        await context.close()
    finally:
        await stop_host(host)


def provider_calls():
    path = ROOT / "vendor/chat-fixture/controlled-provider.json"
    return json.loads(path.read_text()).get("calls") if path.exists() else 0


async def wait_for_calls(page, expected, timeout=60.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if provider_calls() == expected:
            return
        await page.wait_for_timeout(100)
    raise AssertionError(f"controlled provider calls {provider_calls()} != {expected}")


async def retry_diagnostics(page):
    return {
        "attempt": await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-attempt"),
        "settled": await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-settled"),
        "reason": await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-reason"),
        "evidence": await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-evidence"),
        "note": await page.locator("[data-chat-retry-notice]").inner_text(),
        "status": await page.locator("[data-chat-retry-status]").inner_text() if await page.locator("[data-chat-retry-status]").count() else "",
        "settlement": await page.locator("[data-chat-settlement]").inner_text(),
        "calls": provider_calls(),
    }


async def wait_retry_settled(page, timeout=90000):
    try:
        await page.wait_for_selector('[data-chat-retry-attempt][data-chat-retry-settled="true"]', state="attached",
                                   timeout=timeout)
    except Exception:
        print("RETRY_STATE", await retry_diagnostics(page))
        print("RETRY_BODY", (await page.locator("[data-chat-retry]").inner_text())[:1200])
        raise


def native_message_counts(native_id="native-0000"):
    """Native ground truth: the Chat projection exposes a bounded window, so totals come from the journal."""
    path = ROOT / f"vendor/chat-fixture/sessions/bucket/{native_id}.jsonl"
    users = assistants = 0
    for line in path.read_text().splitlines():
        record = json.loads(line)
        if record.get("type") == "message":
            role = record["message"].get("role")
            users += role == "user"
            assistants += role == "assistant"
    return users, assistants


async def wait_retried_region(page, prompt, final, timeout=60000):
    """The preserved failed entry and the one new native answer, in order, with no retry user row."""
    try:
        await page.wait_for_function(
            """([prompt, final]) => {
              const rows = [...document.querySelectorAll('[data-chat-node]')];
              const matched = rows.filter(row => row.dataset.chatNode === 'user' && row.innerText.includes(prompt));
              const at = rows.indexOf(matched[0]);
              const next = rows[at + 1], after = rows[at + 2];
              return matched.length === 1 && at >= 0
                && next?.dataset.chatNode === 'assistant' && next.innerText.includes('synthetic retryable terminal error')
                && after?.dataset.chatNode === 'assistant' && after.innerText.includes(final)
                && !rows.some(row => row.dataset.chatNode === 'user' && row.innerText.includes('/retry'));
            }""", arg=[prompt, final], timeout=timeout)
    except Exception:
        print("RETRY_ROWS", [(await row.get_attribute("data-chat-node"),
                              (await row.inner_text()).replace("\n", " / ")[:160])
                             for row in await page.locator("[data-chat-node]").all()])
        raise


async def phase_retry(browser, errors, scenarios, grant_first=False):
    """A real terminal model failure is retried only by an explicit confirmed native /retry."""
    host = await start_host(scenario="retry", delay=100)
    try:
        context, page = await new_page(browser, errors)
        if grant_first:
            await grant(page)
        await open_session(page)
        await send(page, "retryable failure before retry")
        await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
        assert "failed" in await page.locator("[data-chat-settlement]").inner_text(), "first provider call settles failed"
        await wait_for_calls(page, 1)
        assert await page.locator("[data-chat-retry-attempt]").count() == 0, "a failed turn never retries itself"
        native_before = native_message_counts()
        scenarios.append("retry-failed-turn-not-resubmitted")

        # An explicit cancel consumes the confirmation and sends nothing.
        await page.locator("[data-chat-retry-offer]").click()
        await page.locator("[data-chat-retry-cancel]").wait_for(timeout=10000)
        await page.locator("[data-chat-retry-cancel]").click()
        await expect(page.locator("[data-chat-retry-status]")).to_contain_text("Retry was not sent.", timeout=10000)
        await wait_for_calls(page, 1)
        assert await page.locator("[data-chat-retry-attempt]").count() == 0, "cancelling a confirmation never dispatches"
        scenarios.append("retry-cancel-sends-nothing")

        # A lost confirm reply still delivers exactly one native retry. The View must expose the unknown
        # attempt and recover only through the public receipt lookup, never by sending again.
        await page.get_by_label("Message").fill("draft held across retry")

        async def lose_confirm(route):
            await page.unroute("**/api/ompRetry/confirm", lose_confirm)
            await route.fetch()
            await route.abort()

        await page.route("**/api/ompRetry/confirm", lose_confirm)
        await page.locator("[data-chat-retry-offer]").click()
        await page.locator("[data-chat-retry-confirm]").wait_for(timeout=10000)
        assert "run tools again" in await page.locator("[data-chat-retry-confirmation]").inner_text(), \
            "disclosure precedes dispatch"
        await wait_for_calls(page, 1)
        await page.locator("[data-chat-retry-confirm]").click()
        await page.wait_for_selector('[data-chat-retry-attempt="unknown"]', timeout=60000)
        assert await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-evidence") == "no_response", \
            f"a lost confirm reply is an unknown, not a refusal: {await retry_diagnostics(page)}"
        assert await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-settled") == "false"
        await wait_for_calls(page, 2)
        assert await page.locator("[data-chat-retry-lookup]").count() == 1, \
            "only an explicit lookup can read the lost outcome back"
        await page.locator("#conversation").get_by_text("authoritative controlled final", exact=True).last.wait_for(timeout=60000)
        for _ in range(120):
            if await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-attempt") != "unknown":
                break
            lookup = page.locator("[data-chat-retry-lookup]")
            if await lookup.count() == 0:
                break
            await lookup.click()
            await page.wait_for_timeout(500)
        await wait_retry_settled(page)
        assert await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-attempt") == "succeeded", \
            f"the retried native turn succeeded: {await retry_diagnostics(page)}"
        assert await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-evidence") == ""
        await wait_for_calls(page, 2)
        assert await page.get_by_label("Message").input_value() == "draft held across retry", "retry keeps the draft"
        native_after = native_message_counts()
        assert native_after == (native_before[0], native_before[1] + 1), \
            f"retry preserves the original and appends one native assistant entry: {native_before} -> {native_after}"
        assert await page.locator("[data-chat-turn-error]").count() == 0, "the failed native turn renders inline"
        await wait_retried_region(page, "retryable failure before retry", "authoritative controlled final")
        scenarios.append("retry-lost-reply-unknown-then-one-native-attempt-recovers")

        # A second explicit retry reaches native and is reported as a refusal with no model call.
        await page.locator("[data-chat-retry-offer]").click()
        await page.locator("[data-chat-retry-confirm]").click()
        await page.wait_for_selector('[data-chat-retry-attempt="failed"]', timeout=60000)
        await page.wait_for_selector('[data-chat-retry-settled="true"]', timeout=60000)
        assert await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-reason") == "native_refused", \
            "a refused native retry is reported as a refusal, not an unknown"
        assert "Nothing to retry" in await page.locator("[data-chat-retry-status]").inner_text()
        await wait_for_calls(page, 2)
        assert native_message_counts() == native_after, "a refused retry appends no native entry"
        scenarios.append("retry-native-refusal-explicit-no-model-call")
        await page.screenshot(path=str(ROOT / "vendor/chat-retry.png"), full_page=True)
        assert not errors, errors

        # The original failure and the one retried answer survive a Host restart; no retry is replayed.
        await stop_host(host)
        host = await start_host()
        await page.reload()
        await page.wait_for_selector("[data-chat-root-slot]")
        await open_session(page)
        await wait_retried_region(page, "retryable failure before retry", "authoritative controlled final")
        assert await page.locator("[data-chat-retry-attempt]").count() == 0, "a restarted worker has no retry attempt"
        assert native_message_counts() == native_after, "history keeps exactly the original and one retried entry"
        scenarios.append("retry-history-preserved-across-host-restart")

        # One admitted Chat View owns a worker. A second page that opens the same Session revokes the first,
        # so the displaced page's offer is refused without a native dispatch.
        context_b, page_b = await new_page(browser, errors)
        try:
            try:
                await open_session(page_b)
            except Exception:
                await grant(page_b)
                await open_session(page_b)
            await page.locator("[data-chat-retry-offer]").click()
            await expect(page.locator("[data-chat-retry-status]")).to_contain_text("no longer authorizes Retry",
                                                                                   timeout=30000)
            assert await page.locator("[data-chat-retry-attempt]").count() == 0, "the displaced page starts no attempt"
            await wait_for_calls(page, 2)
            scenarios.append("retry-second-page-owns-session-displaced-view-refused")
        finally:
            await context_b.close()
        await context.close()
    finally:
        await stop_host(host)


async def phase_retry_stop(browser, errors, scenarios):
    """Stop during a replayed failed tool batch: the replay is real, visible and settles cancelled."""
    host = await start_host(scenario="retry-tool", delay=100)
    try:
        context, page = await new_page(browser, errors)
        await open_session(page)
        audit = ROOT / "vendor/chat-fixture/retry-tool-audit.json"
        await send(page, "use the retry tool")
        await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
        for _ in range(100):
            if audit.exists() and json.loads(audit.read_text()).get("stage") == "running": break
            await page.wait_for_timeout(100)
        assert json.loads(audit.read_text())["executions"] == 1, "the first controlled tool execution reached the worker"
        await page.get_by_role("button", name="Stop", exact=True).click()
        await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
        assert "cancelled" in await page.locator("[data-chat-settlement]").inner_text(), "the aborted tool turn settles cancelled"
        assert json.loads(audit.read_text())["stage"] == "aborted", "the worker observed the tool abort"
        await page.get_by_label("Message").fill("draft held across retry stop")
        await page.locator("[data-chat-retry-offer]").click()
        await page.locator("[data-chat-retry-confirm]").click()
        for _ in range(100):
            facts = json.loads(audit.read_text()) if audit.exists() else {}
            if facts.get("stage") == "running" and facts.get("executions") == 2: break
            await page.wait_for_timeout(100)
        else: raise AssertionError("native retry did not re-execute the aborted tool batch")
        scenarios.append("retry-replays-aborted-tool-batch")
        await page.get_by_role("button", name="Stop", exact=True).click()
        await page.wait_for_selector('[data-chat-retry-settled="true"]', timeout=90000)
        assert await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-attempt") == "cancelled", \
            "stopping the retried turn settles the attempt cancelled"
        assert json.loads(audit.read_text())["stage"] == "aborted", "the replayed tool execution was aborted"
        assert await page.get_by_label("Message").input_value() == "draft held across retry stop", "Stop during retry keeps the draft"
        await page.wait_for_timeout(1500)
        await page.get_by_label("Message").fill("after retry stop")
        await page.get_by_role("button", name="Send", exact=True).click()
        await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
        await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
        assert "succeeded" in await page.locator("[data-chat-settlement]").inner_text(), "admission recovers after a stopped retry"
        scenarios.append("retry-stop-settles-cancelled-and-recovers-admission")
        await context.close()
    finally:
        await stop_host(host)


async def main():
    if os.environ.get("OMP_BROWSER_ONLY_RETRY") == "1":
        subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                       stdout=subprocess.DEVNULL)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            scenarios = []
            await phase_retry(browser, [], scenarios, grant_first=True)
            await phase_retry_stop(browser, [], scenarios)
            await browser.close()
            print(json.dumps({"status": "PASS", "scenarios": scenarios}))
        return
    if os.environ.get("OMP_BROWSER_ONLY_PENDING_UI") == "1":
        subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                       stdout=subprocess.DEVNULL)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            await phase_pending_ui(browser, [], grant_first=True)
            await browser.close()
        return
    kill_worker()
    subprocess.run(["pkill", "-f", f"{HOST}"], check=False)
    await asyncio.sleep(0.5)
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    shutil.rmtree(ROOT / "vendor/chat-access", ignore_errors=True)
    errors, wire, scenarios = [], [], []
    host = await start_host()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            context, page = await new_page(browser, errors)
            page.on("response", lambda response: wire.append({"status": response.status, "path": response.url.split("?")[0]})
                    if "/api/" in response.url else None)

            # Phase 1: explicit grant, real text, acceptance echo, reload reuse, two-Session isolation, settlement.
            await grant(page)
            await open_session(page)
            first_worker = await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id")
            await send(page, "authoritative controlled final")
            try:
                await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            except Exception:
                print("SEND_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
                print("SEND_ATTEMPT", [await e.inner_text() for e in await page.locator("[data-chat-attempt]").all()])
                raise
            await page.wait_for_selector('[data-chat-native-entry="accepted"]', timeout=60000)
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            assert "succeeded" in await page.locator("[data-chat-settlement]").inner_text(), "accepted prompt settles succeeded"
            assert await page.get_by_label("Message").input_value() == "", "accepted clears text"
            await page.wait_for_selector('[data-chat-draft-ready="true"]', state="attached", timeout=60000)
            await page.get_by_label("Message").fill("draft survives reload")
            await wait_draft(page, "draft survives reload")
            await page.reload()
            try:
                await page.wait_for_selector("[data-chat-worker-id]:not([data-chat-worker-id=''])", timeout=45000)
            except Exception:
                await open_session(page, "native-0000")
            assert await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session") == "native-0000", "reload same session"
            assert await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id") == first_worker, "reload reuses the live worker"
            await expect(page.get_by_label("Message")).to_have_value("draft survives reload", timeout=30000)
            scenarios.append("page-reload-same-worker")

            await open_session(page, "native-0001")
            assert await page.get_by_label("Message").input_value() == "", "draft does not cross Sessions"
            assert "authoritative controlled final" not in await page.locator("#conversation").inner_text(), "history does not cross Sessions"
            assert await page.locator("[data-chat-native-entry]").count() == 0, "accepted echo does not cross Sessions"
            identity_text = await page.locator("[data-chat-native-session]").inner_text()
            assert "instance" in identity_text, "Session source identity is rendered"
            scenarios.append("two-session-source-isolation")
            await page.get_by_label("Message").fill("other session draft")
            await wait_draft(page, "other session draft")
            await page.reload()
            try:
                await page.wait_for_selector('[data-chat-native-session="native-0001"]', timeout=45000)
            except Exception:
                await open_session(page, "native-0001")
            await expect(page.get_by_label("Message")).to_have_value("other session draft", timeout=60000)
            await page.get_by_role("button", name="Refresh catalog").click()
            await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name=CHAT_BUTTON).click()
            await page.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=60000)
            await expect(page.get_by_label("Message")).to_have_value("draft survives reload", timeout=30000)
            await page.get_by_role("button", name="Send", exact=True).click()
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            assert "succeeded" in await page.locator("[data-chat-settlement]").inner_text(), "relaunched Session settles succeeded"
            await context.close()

            # Phase 1b-1d: render one call, then a batched same-id reuse, all from native history.
            await stop_host(host)
            host = await start_host(tools="all")
            context, page = await new_page(browser, errors)
            await open_session(page, "native-0001")
            await send(page, "use the controlled tool")
            await page.locator('#conversation').get_by_text("use the controlled tool", exact=True).last.wait_for(timeout=60000)
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            assert "succeeded" in await page.locator("[data-chat-settlement]").inner_text(), "tool turn settles succeeded"
            await page.wait_for_selector('[data-chat-tool="s0_fixture"]', timeout=60000)
            assert '"path": "controlled.txt"' in await page.locator('[data-chat-tool="s0_fixture"]').last.inner_text(), "actual parsed arguments render"
            await page.wait_for_selector('[data-chat-tool-result="s0_fixture"]', timeout=60000)
            tool_text = await page.locator('[data-chat-tool-result="s0_fixture"]').last.inner_text()
            assert "controlled result" in tool_text, "native tool result renders"
            assert "controlled-signature" in tool_text, "native thought signature renders"
            assert await page.locator("[data-chat-usage]").count() > 0, "native usage renders"
            scenarios.append("native-tool-call-result-pairing")

            # A second live prompt on the same native Session must append its turn from live frames alone:
            # no reload, no Session switch, and no manual worker Refresh.
            await page.wait_for_timeout(4000)
            await page.evaluate("""() => {
              window.ompRefreshClicks = 0;
              const refresh = document.querySelector('[data-chat-refresh]');
              if (!refresh) throw new Error('missing refresh control');
              refresh.addEventListener('click', () => { window.ompRefreshClicks += 1; }, true);
            }""")
            await send(page, "second live prompt")
            await page.wait_for_timeout(2000)
            await page.locator('#conversation').get_by_text("second live prompt", exact=True).last.wait_for(timeout=60000)
            await page.locator('#conversation').get_by_text("authoritative controlled final", exact=True).last.wait_for(timeout=60000)
            assert await page.evaluate("() => window.ompRefreshClicks") == 0, "second live prompt must not need a manual Refresh worker"
            scenarios.append("second-live-prompt")

            # A fresh Session issues two calls in one step, then reuses both ids after their results.
            await open_session(page, "native-0002")
            await send(page, "use all controlled tools in background")
            await page.locator('#conversation').get_by_text("use all controlled tools in background", exact=True).last.wait_for(timeout=60000)
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            assert "succeeded" in await page.locator("[data-chat-settlement]").inner_text(), "batch turn settles succeeded"
            await page.wait_for_selector('[data-chat-tool="s0_fixture_batch"]', timeout=60000)
            first_args = await page.locator('[data-chat-tool="s0_fixture"]').all_inner_texts()
            second_args = await page.locator('[data-chat-tool="s0_fixture_batch"]').all_inner_texts()
            assert len(first_args) >= 2 and all('batch-one.txt' in text for text in first_args), "first id args render twice"
            assert len(second_args) >= 2 and all('batch-two.txt' in text for text in second_args), "second id args render twice"
            first_results = await page.locator('[data-chat-tool-result="s0_fixture"]').all_inner_texts()
            second_results = await page.locator('[data-chat-tool-result="s0_fixture_batch"]').all_inner_texts()
            assert len(first_results) >= 2 and all('controlled result' in text for text in first_results), "first id results pair twice"
            assert len(second_results) >= 2 and all('controlled batch result' in text for text in second_results), "second id results pair twice"
            assert await page.locator('[data-chat-blocked="unknown-node"]').count() == 0, "reuse is not blocked as ambiguity"
            scenarios.append("native-tool-batch-id-reuse")

            # Reopen once: every tool record, signature and usage remains native-sourced.
            await page.reload()
            await page.wait_for_selector("[data-chat-root-slot]")
            await open_session(page, "native-0002")
            await page.wait_for_selector('[data-chat-tool-result="s0_fixture_batch"]', timeout=60000)
            assert len(await page.locator('[data-chat-tool-result="s0_fixture_batch"]').all_inner_texts()) >= 2, "batch history survives reopen"
            assert len(await page.locator('[data-chat-tool-result="s0_fixture"]').all_inner_texts()) >= 2, "reused id history survives reopen"
            scenarios.append("native-tool-history-reopen")

            # The same first turn also starts a real async bash call: call first, native output later.
            await page.wait_for_selector('[data-chat-tool="bash"]', timeout=60000)
            assert '"async": true' in await page.locator('[data-chat-tool="bash"]').last.inner_text(), "background call arguments render"
            await page.locator('#conversation').get_by_text("background fixture result").last.wait_for(timeout=60000)
            # The native async delivery resumes the model; let that follow-up turn settle before reload.
            await page.locator('#conversation').get_by_text("authoritative controlled final").last.wait_for(timeout=60000)
            await page.wait_for_timeout(1500)
            assert await page.locator('[data-chat-blocked="unknown-node"]').count() == 0, "background result is typed and visible"
            scenarios.append("native-background-tool-result")

            await context.close()

            # Phase 2: slow controlled stream -> busy refusal with retained draft, then native cancel settles.
            await stop_host(host)
            host = await start_host(delay=2000)
            context, page = await new_page(browser, errors)
            await open_session(page)
            await send(page, "streaming before cancel")
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await page.get_by_label("Message").fill("second while busy")
            await page.get_by_role("button", name="Send", exact=True).click()
            await expect(page.get_by_role("alert")).to_contain_text("Native Session is busy. Your draft is retained.", timeout=60000)
            assert await page.get_by_label("Message").input_value() == "second while busy", "busy refusal retains the draft"
            scenarios.append("busy-refusal-retains-draft")
            await page.get_by_role("button", name="Stop", exact=True).click()
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            settlement = await page.locator("[data-chat-settlement]").inner_text()
            assert "cancelled" in settlement, f"stop settles cancelled: {settlement}"
            await page.wait_for_selector("[data-chat-stop-status]", state="detached", timeout=60000)
            assert await page.locator("[data-chat-stop-offer]").count() == 0, "ordinary stop offers no force before 30s"
            assert await page.get_by_label("Message").input_value() == "second while busy", "stop keeps the queued draft"
            scenarios.append("ordinary-stop-settles-cancelled-keeps-draft")

            # Idle Stop is a no-op for input: no force offer, no restored draft, draft intact.
            await page.get_by_role("button", name="Stop", exact=True).click()
            await page.wait_for_timeout(2000)
            assert await page.locator("[data-chat-stop-status]").count() == 0, "idle stop returns to idle"
            assert await page.locator("[data-chat-stop-offer]").count() == 0, "idle stop offers no force"
            assert await page.get_by_label("Message").input_value() == "second while busy", "idle stop keeps the draft"
            scenarios.append("idle-stop-keeps-draft-no-force")
            await context.close()

            # Phase 2b: stubborn public worker -> 30s one-use force -> SIGTERM/SIGKILL reap.
            await stop_host(host)
            host = await start_host(scenario="stubborn", delay=100)
            context, page = await new_page(browser, errors)
            await open_session(page)
            await send(page, "stubborn worker before stop")
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await page.wait_for_timeout(1500)
            await page.get_by_label("Message").fill("draft during stubborn stop")
            await page.get_by_role("button", name="Stop", exact=True).click()
            await page.wait_for_selector('[data-chat-stop-status="stopping"]', timeout=10000)
            await page.wait_for_timeout(5000)
            assert await page.locator("[data-chat-stop-offer]").count() == 0, "force is not offered before 30s"
            await page.wait_for_selector("[data-chat-stop-offer]", timeout=40000)
            scenarios.append("stubborn-force-offered-after-30s")
            pid = subprocess.run(["pgrep", "-f", re.escape(f"{ROOT}/vendor/omp-candidate/cli.js") + ".*--mode rpc-ui"],
                                 capture_output=True, text=True).stdout.split()[0]
            await page.locator("[data-chat-stop-offer]").click()
            await page.locator("[data-chat-stop-confirm]").click()
            for _ in range(300):
                alive = subprocess.run(["pgrep", "-f", re.escape(f"{ROOT}/vendor/omp-candidate/cli.js") + ".*--mode rpc-ui"],
                                       capture_output=True, text=True).stdout.split()
                if pid not in alive: break
                await page.wait_for_timeout(100)
            else: raise AssertionError(f"stubborn worker {pid} was not reaped")
            audit = json.loads((ROOT / "vendor/chat-fixture/stubborn-audit.json").read_text())
            assert audit["exitAt"] > 0, f"stubborn worker exited after force: {audit}"
            assert await page.get_by_label("Message").input_value() == "draft during stubborn stop", "force keeps the draft"
            scenarios.append("stubborn-force-confirm-terminated-reaped")
            await context.close()

            await phase_pending_ui(browser, errors, scenarios)

            # Phase 3: controlled provider terminal error is accepted then settles failed, never resent.
            await stop_host(host)
            host = await start_host(scenario="empty-error")
            context, page = await new_page(browser, errors)
            await open_session(page)
            await send(page, "provider call one")
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            assert "succeeded" in await page.locator("[data-chat-settlement]").inner_text(), "first provider call succeeds"
            await send(page, "provider call two")
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await expect(page.locator("[data-chat-settlement]")).to_contain_text("failed", timeout=60000)
            assert await page.get_by_label("Message").input_value() == "", "provider error is not retried or left as draft"
            assert await page.locator("[data-chat-attempt]").get_attribute("data-chat-attempt") == "accepted", "provider error is not replayed as a new prompt"
            scenarios.append("provider-error-settles-failed-no-resend")
            await context.close()

            # Phase 4: native worker EOF while streaming -> manual reopen of the same native Session.
            await stop_host(host)
            host = await start_host(delay=4000)
            context, page = await new_page(browser, errors)
            await open_session(page)
            eof_worker = await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id")
            await send(page, "streaming before worker EOF")
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            kill_worker()
            await asyncio.sleep(3)
            await page.reload()
            await expect(page.get_by_role("alert")).to_contain_text("Previous worker unavailable. Manually Open the native Session.", timeout=60000)
            await page.get_by_role("button", name="Refresh catalog").click()
            await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name=CHAT_BUTTON).click()
            await page.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=60000)
            reopened_worker = await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id")
            assert reopened_worker != eof_worker, "worker EOF requires a new supervised worker"
            await send(page, "after worker EOF reopen")
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            scenarios.append("worker-eof-manual-reopen")

            # Phase 5: Host + worker restart still requires a manual native reopen before sending.
            await stop_host(host)
            host = await start_host()
            await page.reload()
            await expect(page.get_by_role("alert")).to_contain_text("Previous worker unavailable. Manually Open the native Session.", timeout=60000)
            await page.get_by_role("button", name="Refresh catalog").click()
            await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name=CHAT_BUTTON).click()
            await page.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=60000)
            await send(page, "after host restart reopen")
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            assert "succeeded" in await page.locator("[data-chat-settlement]").inner_text(), "host restart reopen settles succeeded"
            scenarios.append("host-restart-manual-reopen")

            await page.screenshot(path=str(ROOT / "vendor/chat-browser.png"), full_page=True)
            assert not errors, errors
            await context.close()
            await phase_retry(browser, errors, scenarios)
            await phase_retry_stop(browser, errors, scenarios)
            assert not errors, errors
            scenarios = ["authenticated-explicit-grant", "explicit-open", "real-text-success", "accepted-echo",
                         "native-input-reconciliation", "settlement-succeeded", "draft-retained-while-projection-synchronizes",
                         "two-session-draft-isolation", *scenarios]
            result = {"status": "PASS", "platform": "Linux Chromium", "browser": browser.version, "realDSH": True,
                      "realBun": True, "realHost": True, "realChatGateway": True, "scenarios": scenarios,
                      "privateData": False, "productAdmission": "blocked",
                      "wire": wire, "errors": errors}
            (ROOT / "vendor/chat-browser.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps({key: result[key] for key in ("status", "scenarios", "privateData", "productAdmission")}))
            await context.close()
            await browser.close()
    finally:
        await stop_host(host)


if __name__ == "__main__":
    asyncio.run(main())
