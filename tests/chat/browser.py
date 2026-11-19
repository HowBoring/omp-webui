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
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    shutil.rmtree(ROOT / "vendor/chat-access", ignore_errors=True)
    errors, wire = [], []
    subprocess.run(["pkill", "-f", "vendor/host-chat/chat-component-main.js"], check=False)
    host = subprocess.Popen([BUN, "--no-env-file", "vendor/host-chat/chat-component-main.js"], cwd=ROOT,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
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
        page.on("response", lambda response: wire.append({"status": response.status, "path": response.url.split("?")[0]})
                if "/api/" in response.url else None)
        await page.goto(link)
        await page.wait_for_selector("[data-chat-root-slot]")
        await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
        await page.get_by_role("button", name="Review directory", exact=True).click()
        await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name="Open Chat Session").click()
        await page.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=30000)
        worker = await page.locator("[data-chat-worker-id]").get_attribute("data-chat-worker-id")
        await page.get_by_label("Message").fill("authoritative controlled final")
        await page.get_by_role("button", name="Send", exact=True).click()
        await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=30000)
        await page.wait_for_selector('[data-chat-native-entry="accepted"]', timeout=30000)
        assert await page.get_by_label("Message").input_value() == ""
        await page.wait_for_timeout(300)
        await page.get_by_label("Message").fill("slow-input")
        await page.get_by_role("button", name="Send", exact=True).click()
        await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=30000)
        await page.get_by_label("Message").fill("second while busy")
        await page.get_by_role("button", name="Send", exact=True).click()
        await expect(page.get_by_role("alert")).to_contain_text("draft is retained", timeout=30000)
        assert await page.get_by_label("Message").input_value() == "second while busy"
        await page.wait_for_timeout(2000)
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name="Open Chat Session").click()
        await page.wait_for_selector(f'[data-chat-worker-id="{worker}"]', timeout=30000)
        assert await page.get_by_label("Message").input_value() == "second while busy"
        await page.screenshot(path=str(ROOT / "vendor/chat-browser.png"), full_page=True)
        assert not errors, errors
        result = {"status": "PASS", "platform": "Linux Chromium", "browser": browser.version, "realDSH": True,
                  "realBun": True, "realHost": True, "realChatGateway": True,
                  "scenarios": ["authenticated-explicit-grant", "explicit-open", "real-text-success",
                                "accepted-echo", "native-input-reconciliation", "draft-retained-while-projection-synchronizes", "draft-retained-after-refusal", "manual-reopen-same-worker"],
                  "privateData": False, "productAdmission": "blocked", "wire": wire, "errors": errors}
        (ROOT / "vendor/chat-browser.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({key: result[key] for key in ("status", "scenarios", "privateData", "productAdmission")}))
        await context.close()
        await browser.close()
    host.terminate()
    host.wait(timeout=10)


asyncio.run(main())
