"""Actual Linux Chromium -> public DSH prompt -> real Chat Gateway -> strict native worker.

Explicit synthetic S2 fixture; live-provider scenarios are controlled, never real inference.
"""
import asyncio, json, os, shutil, subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"


async def main():
    subprocess.run(["pkill", "-f", "vendor/host-chat/chat-component-main.js"], check=False)
    subprocess.run(["pkill", "-f", "vendor/omp-candidate/cli.js"], check=False)
    await asyncio.sleep(0.5)
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    shutil.rmtree(ROOT / "vendor/chat-access", ignore_errors=True)
    errors, wire = [], []
    host = subprocess.Popen([BUN, "--no-env-file", "vendor/host-chat/chat-component-main.js"], cwd=ROOT,
                            stdout=open(ROOT / "vendor/chat-host.log", "w"), stderr=subprocess.STDOUT)
    import time, urllib.request
    for _ in range(100):
        try:
            urllib.request.urlopen("http://127.0.0.1:3188/healthz", timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    else:
        raise RuntimeError(host.communicate(timeout=5)[0])
    link = subprocess.check_output(
        [BUN, "--no-env-file", "vendor/host-chat/chat-component-main.js", "--print-bootstrap"], cwd=ROOT, text=True).strip()
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
        context = await browser.new_context()
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        async def log_response(response):
            if "/api/" in response.url and response.request.method == "POST":
                try: body = await response.text()
                except Exception: body = "<no body>"
                print("RPC", response.status, response.url.rsplit("/api/", 1)[-1], body[:400].replace("\n", " "))
        page.on("response", log_response)
        page.on("response", lambda response: wire.append({"status": response.status, "path": response.url.split("?")[0]})
                if "/api/" in response.url else None)
        await page.goto(link)
        await page.wait_for_selector("[data-chat-root-slot]")
        await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
        await page.get_by_role("button", name="Review directory", exact=True).click()
        await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name="Open Chat Session").click()
        await page.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=60000)
        worker = await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id")
        await page.get_by_label("Message").fill("authoritative controlled final")
        await page.get_by_role("button", name="Send", exact=True).click()
        try:
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
        except Exception:
            print("SEND_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
            print("SEND_ATTEMPT", [await e.inner_text() for e in await page.locator("[data-chat-attempt]").all()])
            print("SEND_ERRORS", errors[-3:])
            print("SEND_RPC", [w for w in wire if w["path"].endswith(("prompt","attach","lookup"))][-8:])
            raise
        await page.wait_for_selector('[data-chat-native-entry="accepted"]', timeout=60000)
        assert await page.get_by_label("Message").input_value() == "", "accepted clears text"
        await page.wait_for_selector('[data-chat-draft-ready="true"]', state="attached", timeout=60000)
        await page.get_by_label("Message").fill("draft survives reload")
        await page.wait_for_function("""() => Object.keys(localStorage).some(key => key.startsWith("omp.draft.v1:") && localStorage.getItem(key).includes("draft survives reload"))""", timeout=60000)
        await page.reload()
        await page.wait_for_selector("[data-chat-worker-id]:not([data-chat-worker-id=''])", timeout=60000)
        assert await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session") == "native-0000", "reload same session"
        try:
            await expect(page.get_by_label("Message")).to_have_value("draft survives reload", timeout=30000)
        except Exception:
            print("DRAFT_KEYS", await page.evaluate("() => Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])"))
            print("DRAFT_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
            print("DRAFT_ERRORS", errors[-3:])
            raise
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator('li[data-native-id="native-0001"]').get_by_role("button", name="Switch Chat Session").click()
        try:
            await page.wait_for_selector('[data-chat-native-session="native-0001"]', timeout=60000)
        except Exception:
            print("OPEN0001_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
            print("OPEN0001_ATTEMPT", [await e.inner_text() for e in await page.locator("[data-chat-attempt]").all()])
            print("OPEN0001_CURRENT", await page.locator("[data-chat-native-session]").count())
            print("OPEN0001_URL", page.url)
            print("OPEN0001_BODY", (await page.locator("body").inner_text())[:400].replace("\n", "|"))
            print("OPEN0001_ERRORS", errors[-4:])
            print("OPEN0001_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
            print("OPEN0001_VIEW", await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session"))
            print("OPEN0001_BODY", (await page.locator("body").inner_text())[:300].replace("\n", "|"))
            raise
        assert await page.get_by_label("Message").input_value() == ""
        await page.get_by_label("Message").fill("other session draft")
        await page.wait_for_function("""() => Object.keys(localStorage).some(key => key.startsWith("omp.draft.v1:") && localStorage.getItem(key).includes("other session draft"))""", timeout=60000)
        await page.reload()
        try:
            await page.wait_for_selector('[data-chat-native-session="native-0001"]', timeout=60000)
        except Exception:
            print("FAIL0001_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
            print("FAIL0001_BODY", (await page.locator("body").inner_text())[:400].replace("\n", "|"))
            raise
        await expect(page.get_by_label("Message")).to_have_value("other session draft", timeout=60000)
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name="Switch Chat Session").click()
        await page.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=60000)
        try:
            await expect(page.get_by_label("Message")).to_have_value("draft survives reload", timeout=30000)
        except Exception:
            print("DRAFT_KEYS", await page.evaluate("() => Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])"))
            print("DRAFT_ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
            print("DRAFT_ERRORS", errors[-3:])
            raise
        await page.get_by_role("button", name="Send", exact=True).click()
        await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
        await page.get_by_label("Message").fill("second while busy")
        await page.get_by_role("button", name="Send", exact=True).click()
        await expect(page.get_by_role("alert")).to_contain_text("Native Session is busy. Your draft is retained.", timeout=60000)
        assert await page.get_by_label("Message").input_value() == "second while busy"
        await page.screenshot(path=str(ROOT / "vendor/chat-browser.png"), full_page=True)
        assert not errors, errors
        result = {"status": "PASS", "platform": "Linux Chromium", "browser": browser.version, "realDSH": True,
                  "realBun": True, "realHost": True, "realChatGateway": True,
                  "scenarios": ["authenticated-explicit-grant", "explicit-open", "real-text-success",
                                "accepted-echo", "native-input-reconciliation", "draft-retained-while-projection-synchronizes", "page-reload-same-worker", "two-session-draft-isolation"],
                  "privateData": False, "productAdmission": "blocked", "wire": wire, "errors": errors}
        (ROOT / "vendor/chat-browser.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({key: result[key] for key in ("status", "scenarios", "privateData", "productAdmission")}))
        await context.close()
        await browser.close()
    host.terminate()
    host.wait(timeout=10)


asyncio.run(main())
