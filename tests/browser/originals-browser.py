"""Actual Chromium -> public history route: retained Originals after a committed attachment Send (#56).

Drives the composed Chat Host with the controlled native attachment provider, then reads the
Original only through the same-origin route the Session Tree renders.
"""
import asyncio, hashlib, json, os, re, shutil, signal, sqlite3, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = ROOT / "vendor/host-chat/chat-component-main.js"
PORT = os.environ.get("OMP_ORIGINALS_PORT", "3196")
ORIGIN = f"http://127.0.0.1:{PORT}"
DATA = ROOT / "vendor/chat-originals-access"
WITNESS = b"original bytes witness, not model input\n"


def env():
    value = os.environ.copy()
    value.update({"OMP_CHAT_ATTACHMENTS": "1", "OMP_CHAT_FIXTURE_PORT": PORT,
                  "OMP_CHAT_FIXTURE_DATA": str(DATA), "OMP_CHAT_CANDIDATE": "vendor/omp-candidate/cli.js"})
    return value


async def wait_health(timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"{ORIGIN}/healthz", timeout=1)
            return
        except Exception:
            await asyncio.sleep(0.25)
    raise RuntimeError("originals Chat Host did not become healthy")


async def until(check, timeout=60.0, interval=0.2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = await check()
        if value:
            return value
        await asyncio.sleep(interval)
    raise AssertionError(f"condition not reached; last {value!r}")


async def grant(page):
    await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
    await page.get_by_role("button", name="Review directory", exact=True).click()
    await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
    await page.get_by_role("button", name="Refresh catalog").click()


async def open_session(page, native_id="native-0000"):
    for attempt in range(2):
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator(f'li[data-native-id="{native_id}"]').get_by_role(
            "button", name=re.compile(r"(Open|Switch) Chat Session")).click()
        try:
            await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=30000)
            return
        except Exception:
            if attempt:
                print("BODY", (await page.locator("body").inner_text())[:1500])
                raise


async def main():
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    shutil.rmtree(DATA / "attachments", ignore_errors=True)
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env(),
                            stdout=open(ROOT / "vendor/originals-host.log", "w"), stderr=subprocess.STDOUT)
    browser = None
    try:
        await wait_health()
        bootstrap = subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"],
                                            cwd=ROOT, env=env(), text=True).strip()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            page = await browser.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(bootstrap)
            await grant(page)
            await open_session(page)

            await page.get_by_label("Add files").set_input_files(
                {"name": "witness.txt", "mimeType": "text/plain", "buffer": WITNESS})
            await expect(page.locator("[data-chat-file-count]")).to_have_attribute(
                "data-chat-file-count", "1", timeout=30000)
            await page.get_by_label("Message").fill("originals acceptance")
            await page.get_by_role("button", name="Send", exact=True).click()
            await page.wait_for_selector('[data-attachment-phase="awaiting-consent"]', timeout=60000)
            await page.get_by_role("button", name=re.compile(
                r"Accept listed changes and continue Send|Continue this Send attempt")).click()
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await page.wait_for_selector('[data-chat-native-entry="accepted"]', timeout=60000)

            # Production composition regression: the sent Original is durably held and associated, never plain staged.
            database = sqlite3.connect(DATA / "attachments" / "originals.sqlite")
            assert database.execute("SELECT count(*) FROM original_submissions").fetchone()[0] == 1
            assert database.execute("SELECT count(*) FROM original_submission_holds").fetchone()[0] == 1
            assert database.execute("SELECT count(*) FROM original_entry_links").fetchone()[0] == 1
            assert database.execute("SELECT count(*) FROM originals WHERE state='native-associated'").fetchone()[0] == 1
            assert database.execute("SELECT count(*) FROM originals WHERE state='staged-unprepared'").fetchone()[0] == 0
            database.close()

            tree = page.locator("[data-chat-tree]")
            await tree.get_by_role("button", name="Open current tree").click()
            await expect(tree.get_by_text("Complete native tree", exact=True)).to_be_visible(timeout=30000)
            nodes = tree.locator("ol li button:not([data-chat-branch-point])")
            found = None
            for index in range(await nodes.count()):
                await nodes.nth(index).click()
                links = tree.locator("[data-original-object]")
                try:
                    await until(lambda: links.count(), timeout=5.0, interval=0.1)
                except AssertionError:
                    continue
                found = links.first
                break
            assert found is not None, (await tree.inner_text())[:2000]
            assert await tree.locator('[aria-label="Original files"]').get_by_text(
                "witness.txt").count() == 1

            await tree.get_by_role("button").filter(has_text="· assistant ·").last.click()
            await expect(tree.locator('[aria-label="Original files"]')).to_contain_text(
                "No original is associated", timeout=30000)
            for index in range(await nodes.count()):
                await nodes.nth(index).click()
                links = tree.locator("[data-original-object]")
                try:
                    await until(lambda: links.count(), timeout=5.0, interval=0.1)
                except AssertionError:
                    continue
                found = links.first
                break
            assert await tree.locator("[data-original-object]").count() == 1
            href = await found.get_by_role("link", name="Download original").get_attribute("href")
            assert href and "/api/ompOriginals/original" in href and "disposition=attachment" in href, href
            response = await page.request.get(ORIGIN + href)
            assert response.status == 200, (response.status, await response.text())
            body = await response.body()
            assert body == WITNESS, body
            assert response.headers["content-type"].startswith("text/plain")
            assert response.headers["content-disposition"].startswith("attachment;")
            assert response.headers["x-omp-original-sha256"] == hashlib.sha256(WITNESS).hexdigest()
            assert response.headers["x-content-type-options"] == "nosniff"
            assert "sandbox" in response.headers["content-security-policy"]
            head = await page.request.head(ORIGIN + href)
            assert head.status == 200 and await head.body() == b""
            assert int(head.headers["content-length"]) == len(WITNESS)

            stored = list((DATA / "attachments").glob("*.original"))
            assert len(stored) == 1, stored
            stored[0].write_bytes(b"tampered after commit")
            corrupt = await page.request.get(ORIGIN + href)
            assert corrupt.status == 409, corrupt.status
            assert (await corrupt.json())["error"]["code"] == "attachment_original_corrupt"
            stored[0].unlink()
            missing = await page.request.get(ORIGIN + href)
            assert missing.status == 404, missing.status
            assert (await missing.json())["error"]["code"] == "attachment_original_unavailable"

            guessed = re.sub(r"entryId=[^&]+", "entryId=guessed", href)
            missing_entry = await page.request.get(ORIGIN + guessed)
            assert missing_entry.status == 404, missing_entry.status
            assert (await missing_entry.json())["error"]["code"] == "attachment_entry_unavailable"

            # The Host releases every browser grant on SIGUSR1; the same link must stop working.
            host.send_signal(signal.SIGUSR1)
            async def denied():
                response = await page.request.get(ORIGIN + href)
                return response if response.status != 200 else None
            revoked = await until(denied, timeout=15)
            assert revoked.status in (401, 403, 503), revoked.status
            print(json.dumps({"kind": "history-originals-browser", "sha256": hashlib.sha256(WITNESS).hexdigest(),
                              "download": 200, "head": 200, "corrupt": 409, "missing": 404, "guessedEntry": 404, "revoked": 403,
                              "errors": errors}))
    finally:
        if browser is not None:
            await browser.close()
        if host.poll() is None:
            host.send_signal(signal.SIGTERM)
            try:
                host.wait(timeout=10)
            except subprocess.TimeoutExpired:
                host.kill()


if __name__ == "__main__":
    asyncio.run(main())
