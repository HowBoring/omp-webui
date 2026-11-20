"""Actual Chromium -> public Originals RPCs: usage, Host-known impact preview, confirmed whole-Original delete.

A stale preview is exercised against a real in-flight submission attempt: the occupied state changes the
gate revision, so confirmation must refuse and require a fresh review instead of queueing a deletion.
"""
import asyncio, json, os, re, shutil, signal, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = Path(os.environ.get("OMP_CHAT_HOST_DIR", ROOT / "vendor/host-chat")) / "chat-component-main.js"
PORT = os.environ.get("OMP_CHAT_CLEANUP_PORT", "3194")
ORIGIN = f"http://127.0.0.1:{PORT}"
DATA = ROOT / "vendor/chat-cleanup-access"
FIXTURE_ENV = {"OMP_CHAT_ATTACHMENTS": "1", "OMP_CHAT_FIXTURE_PORT": PORT, "OMP_CHAT_FIXTURE_DATA": str(DATA),
               "OMP_CHAT_CANDIDATE": "vendor/omp-candidate/cli.js"}


def free_port():
    subprocess.run(["bash", "-c", f"lsof -ti:{PORT} | xargs -r kill -9"], check=False)


async def wait_health(timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{ORIGIN}/healthz", timeout=1) as response:
                if response.status == 200: return
        except Exception:
            await asyncio.sleep(0.25)
    raise RuntimeError("cleanup Chat Host did not become healthy")


async def start_host():
    env = os.environ.copy(); env.update(FIXTURE_ENV)
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env,
                            stdout=open(ROOT / "vendor/chat-cleanup-host.log", "w"), stderr=subprocess.STDOUT)
    await wait_health()
    return host


def bootstrap():
    env = os.environ.copy(); env.update(FIXTURE_ENV)
    return subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"], cwd=ROOT, env=env, text=True).strip()


async def stop_host(host):
    if host.poll() is None:
        host.send_signal(signal.SIGTERM)
        try: host.wait(timeout=10)
        except subprocess.TimeoutExpired: host.kill(); host.wait(timeout=5)
    await asyncio.sleep(0.5)


async def grant(page):
    await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
    await page.get_by_role("button", name="Review directory", exact=True).click()
    await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
    await page.get_by_role("button", name="Refresh catalog").click()


async def open_session(page):
    for attempt in range(2):
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator('li[data-native-id="native-0000"]').get_by_role("button", name=re.compile(r"(Open|Switch) Chat Session")).click()
        try:
            await page.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=30000)
            return
        except Exception:
            print("OPEN_ALERTS", await page.get_by_role("alert").all_inner_texts())
            if attempt:
                await page.screenshot(path=str(ROOT / "vendor/chat-cleanup-open-fail.png"), full_page=True)
                raise


async def upload(page, name, data):
    await page.get_by_label("Add files").set_input_files({"name": name, "mimeType": "text/plain", "buffer": data})
    await page.get_by_text("Inspecting and staging the file…").wait_for(state="detached")


async def wait_count(page, count):
    await expect(page.locator("[data-chat-file-count]")).to_have_attribute("data-chat-file-count", str(count), timeout=30000)


async def wait_alert(page, text, timeout=30000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if any(text in value for value in await page.get_by_role("alert").all_inner_texts()): return
        await asyncio.sleep(0.2)
    raise AssertionError(f"alert did not contain {text!r}: {await page.get_by_role('alert').all_inner_texts()}")


async def usage(page):
    line = page.locator("[data-chat-originals-usage]")
    return int(await line.get_attribute("data-chat-originals-usage")), int(await line.get_attribute("data-chat-originals-usage-limit"))


async def main():
    free_port(); await asyncio.sleep(0.5)
    # A previous browser run may have left the controlled native fixture mid-turn; rebuild it first.
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    shutil.rmtree(DATA, ignore_errors=True)
    host = await start_host()
    scenarios = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            context = await browser.new_context(); page = await context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(bootstrap()); await page.wait_for_selector("[data-chat-root-slot]")
            await grant(page); await open_session(page)

            payload = b"same bytes\n"
            await upload(page, "same.txt", payload); await wait_count(page, 1)
            await upload(page, "same-copy.txt", payload); await wait_count(page, 2)
            charged, limit = await usage(page)
            assert charged == 2 * len(payload) and limit == 10 * 1024 ** 3, (charged, limit)
            assert await page.get_by_text("Host storage:").count() == 1, "Host usage is visible before deleting"
            scenarios.append("usage-shows-charged-and-10gib-limit")

            first = page.locator("[data-chat-original-id]").first
            object_id = await first.get_attribute("data-chat-original-id")
            await first.locator("[data-chat-original-delete]").click()
            dialog = page.locator(f'[data-chat-deletion-preview="{object_id}"]')
            await dialog.wait_for()
            text = await dialog.inner_text()
            assert "loses access" in text and "Native history and saved model input are not changed" in text, text
            assert "Independent Originals with the same bytes are kept" in text, text
            assert await usage(page) == (charged, limit)
            await dialog.locator("[data-chat-delete-confirm]").click()
            await dialog.wait_for(state="detached")
            await wait_count(page, 1)
            after, _ = await usage(page)
            assert after == charged - len(payload), (after, charged)
            scenarios.append("impact-preview-confirm-deletes-one-logical-original")

            # Same bytes are independent: the sibling survives and remains independently deletable.
            sibling = page.locator("[data-chat-original-id]").first
            assert await sibling.get_attribute("data-chat-original-id") != object_id
            await upload(page, "race.txt", b"race bytes\n"); await wait_count(page, 2)
            race = page.locator('[data-chat-original-id]:has-text("race.txt")')
            race_id = await race.get_attribute("data-chat-original-id")
            await race.locator("[data-chat-original-delete]").click()
            race_dialog = page.locator(f'[data-chat-deletion-preview="{race_id}"]')
            await race_dialog.wait_for()
            preview_charge = (await usage(page))[0]

            # A real in-flight Send occupies the exact Originals and invalidates the outstanding review.
            await page.get_by_label("Message").fill("cleanup race")
            await page.get_by_role("button", name="Send", exact=True).click()
            await page.wait_for_selector('[data-attachment-phase="awaiting-consent"]', timeout=60000)
            await race_dialog.locator("[data-chat-delete-confirm]").click()
            await race_dialog.wait_for(state="detached")
            await wait_alert(page, "start a new deletion review")
            assert await page.locator(f'[data-chat-original-id="{race_id}"]').count() == 1, "occupied Original is retained"
            assert (await usage(page))[0] == preview_charge, "refused deletion reclaims nothing"
            scenarios.append("occupied-attempt-invalidates-preview-and-retains-bytes")

            await page.get_by_role("button", name="Cancel this Send attempt").click()
            await page.wait_for_selector('[data-chat-attempt="refused"]', timeout=60000)
            await wait_count(page, 2)
            await page.locator(f'[data-chat-original-id="{race_id}"] [data-chat-original-delete]').click()
            await page.locator(f'[data-chat-deletion-preview="{race_id}"] [data-chat-delete-confirm]').click()
            await page.locator(f'[data-chat-deletion-preview="{race_id}"]').wait_for(state="detached")
            await wait_count(page, 1)
            assert (await usage(page))[0] == preview_charge - len(b"race bytes\n")
            scenarios.append("fresh-review-after-resolution-deletes")

            await page.screenshot(path=str(ROOT / "vendor/chat-cleanup.png"), full_page=True)
            assert not errors, errors
            print(json.dumps({"status": "PASS", "browser": browser.version, "scenarios": scenarios,
                              "privateData": False, "productAdmission": "blocked"}))
            await context.close(); await browser.close()
    finally:
        await stop_host(host)


if __name__ == "__main__":
    asyncio.run(main())
