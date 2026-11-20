"""Real Linux Chromium -> product Chat Host -> real native OMP durable navigation.

The fixture is synthetic; the native worker, RPC, and projection are real. Proves preview does not
send input, confirmation returns to the native parent, and the returned message stays a draft.
"""
import asyncio, os, re, shutil, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = ROOT / "vendor/host-chat/chat-component-main.js"
PORT = int(os.environ.get("OMP_NAV_PORT", "3195"))
CHAT_BUTTON = re.compile(r"(Open|Switch) Chat Session")


def env():
    value = os.environ.copy()
    value["OMP_CHAT_PORT"] = value["OMP_CHAT_FIXTURE_PORT"] = str(PORT)
    value["OMP_CHAT_FIXTURE_DATA"] = str(ROOT / "vendor/nav-browser-access")
    return value


async def wait_health(timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1)
            return
        except Exception:
            await asyncio.sleep(0.1)
    raise RuntimeError("navigation Chat Host did not become healthy")


async def main():
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env(),
                            stdout=open(ROOT / "vendor/nav-host.log", "w"), stderr=subprocess.STDOUT)
    browser = None
    try:
        await wait_health()
        bootstrap = subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"],
                                            cwd=ROOT, env=env(), text=True).strip()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
            page = await browser.new_page()
            errors, posts = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: posts.append(request.url.split("/api/", 1)[1])
                    if request.method == "POST" and "/api/" in request.url else None)
            await page.goto(bootstrap)
            await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
            await page.get_by_role("button", name="Review directory", exact=True).click()
            await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
            await page.get_by_role("button", name="Refresh catalog").click()
            row = page.locator("li[data-native-id]", has_text=os.environ.get("NAV_SESSION", "Native Tree Session"))
            native_id = await row.get_attribute("data-native-id")
            await row.get_by_role("button", name=CHAT_BUTTON).click()
            await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=60000)
            tree = page.locator("[data-chat-tree]")
            await expect(tree.get_by_role("button", name="Open current tree")).to_be_enabled(timeout=60000)
            await tree.get_by_role("button", name="Open current tree").click()
            target = tree.locator("[data-navigation-target]").first
            await expect(target).to_be_visible(timeout=60000)
            before_prompt = sum(1 for value in posts if value == "session/prompt")
            await target.click()
            confirmation = page.locator("[data-navigation-confirmation]")
            await expect(confirmation).to_be_visible(timeout=60000)
            text = await confirmation.inner_text()
            assert "Session" in text and "parent" in text.lower(), text
            assert "files_and_external_effects_are_not_rolled_back" in text, text
            assert sum(1 for value in posts if value == "session/prompt") == before_prompt
            composer = page.locator('[data-chat-draft]')
            assert await composer.input_value() == ""
            await page.locator("[data-navigation-confirm]").click()
            try:
                await expect(page.locator('[data-navigation-operation="committed"]')).to_be_visible(timeout=60000)
            except Exception:
                print("PANEL", await page.locator("[data-navigation-panel]").inner_text())
                print("ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
                raise
            offer = page.locator("[data-chat-returned-draft]")
            await expect(offer).to_be_visible()
            assert await composer.input_value() == ""
            assert sum(1 for value in posts if value == "session/prompt") == before_prompt
            await offer.get_by_role("button", name=re.compile("Put returned text in the composer")).click()
            assert await composer.input_value() != ""
            assert sum(1 for value in posts if value == "session/prompt") == before_prompt
            assert not errors, errors
            print("NAV_BROWSER_OK", native_id)
    finally:
        if browser is not None:
            await browser.close()
        host.send_signal(subprocess.signal.SIGTERM)
        try:
            host.wait(timeout=10)
        except subprocess.TimeoutExpired:
            host.kill()


asyncio.run(main())
