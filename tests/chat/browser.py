"""Actual Linux Chromium -> public DSH prompt -> real Chat Gateway -> strict native worker.

Explicit synthetic S2 fixture; live-provider scenarios are controlled, never real inference.
"""
import asyncio, json, os, re, shutil, signal, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = Path(os.environ.get("OMP_CHAT_HOST_DIR", ROOT / "vendor/host-chat")) / "chat-component-main.js"
PORT = int(os.environ.get("OMP_CHAT_FIXTURE_PORT", "3188"))
CHAT_BUTTON = re.compile(r"(Open|Switch) Chat Session")


def kill_worker():
    subprocess.run(["pkill", "-f", "vendor/omp-candidate/cli.js.*--mode rpc-ui"], check=False)


async def wait_health(timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1)
            return
        except Exception:
            await asyncio.sleep(0.1)
    raise RuntimeError("chat Host did not become healthy")


async def start_host(scenario=None, delay=None):
    env = os.environ.copy()
    if scenario:
        env["OMP_CHAT_FIXTURE_SCENARIO"] = scenario
    if delay is not None:
        env["OMP_CHAT_FIXTURE_DELAY_MS"] = str(delay)
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env,
                            stdout=open(ROOT / "vendor/chat-host.log", "w"), stderr=subprocess.STDOUT)
    await wait_health()
    return host


def bootstrap():
    return subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"], cwd=ROOT, text=True).strip()


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
        print("OPEN_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
        print("OPEN_SESSION", await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session"),
              await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id"))
        print("OPEN_STORAGE", await page.evaluate("() => ({local: {...localStorage}, session: {...sessionStorage}})"))
        raise


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


async def main():
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
                await page.wait_for_selector("[data-chat-worker-id]:not([data-chat-worker-id=''])", timeout=60000)
            except Exception:
                print("RELOAD_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
                print("RELOAD_BODY", (await page.locator("body").inner_text())[:1200])
                print("RELOAD_STORAGE", await page.evaluate("() => ({local: {...localStorage}, session: {...sessionStorage}})"))
                raise
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
            await page.wait_for_selector('[data-chat-native-session="native-0001"]', timeout=60000)
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
            await page.get_by_role("button", name="Cancel", exact=True).click()
            await page.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            settlement = await page.locator("[data-chat-settlement]").inner_text()
            assert "cancelled" in settlement, f"cancel settles cancelled: {settlement}"
            assert await page.get_by_label("Message").input_value() == "second while busy", "cancel keeps the queued draft"
            scenarios.append("native-cancel-settles")
            await context.close()

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
            scenarios = ["authenticated-explicit-grant", "explicit-open", "real-text-success", "accepted-echo",
                         "native-input-reconciliation", "settlement-succeeded", "draft-retained-while-projection-synchronizes",
                         "two-session-draft-isolation", *scenarios]
            result = {"status": "PASS", "platform": "Linux Chromium", "browser": browser.version, "realDSH": True,
                      "realBun": True, "realHost": True, "realChatGateway": True, "scenarios": scenarios,
                      "privateData": False, "productAdmission": "blocked", "wire": wire, "errors": errors}
            (ROOT / "vendor/chat-browser.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps({key: result[key] for key in ("status", "scenarios", "privateData", "productAdmission")}))
            await context.close()
            await browser.close()
    finally:
        await stop_host(host)


asyncio.run(main())
