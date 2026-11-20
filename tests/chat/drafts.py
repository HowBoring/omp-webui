"""Actual Chromium evidence for #57: page-tab draft hydration, Host reauthorization, isolation and missing Originals.

Runs against the same controlled Native Chat fixture as tests/chat/images.py. Only observed outcomes are
recorded; a rebuild that cannot present a Session is reported as a boundary, never as recovery.
"""
import asyncio, json, os, sys, uuid
from pathlib import Path
from playwright.async_api import expect
sys.path.insert(0, str(Path(__file__).resolve().parent))
import images as base

ROOT = base.ROOT


async def draft_record(page):
    raw = await page.evaluate("""() => {
      const key = Object.keys(sessionStorage).find(name => name.startsWith('omp.draft.v1:'));
      return key === undefined ? null : sessionStorage.getItem(key);
    }""")
    return json.loads(raw) if raw else None


async def wait_text(page, text, timeout=30000):
    await expect(page.get_by_label("Message")).to_have_value(text, timeout=timeout)


async def visible_originals(page):
    return await page.locator("[data-chat-original-id]").count()


async def journal_lines():
    path = ROOT / "vendor/chat-attachment-fixture/sessions/bucket/native-0000.jsonl"
    return len(path.read_text().splitlines()) if path.exists() else 0


async def main():
    base.free_port(); await asyncio.sleep(0.5)
    import subprocess
    subprocess.run([base.BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    import shutil
    shutil.rmtree(base.DATA, ignore_errors=True)
    errors, cases, boundaries = [], [], []
    link = base.bootstrap(); host = await base.start_host()
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=base.CHROME, headless=True, args=["--no-sandbox"])
            context = await browser.new_context()
            page = await context.new_page()
            page.on("pageerror", lambda error: (errors.append(str(error)), print("PAGEERROR", error)))
            page.on("console", lambda message: print("CONSOLE", message.type, message.text[:400]) if message.type in ("error", "warning") else None)
            await page.goto(link)
            for _ in range(60):
                if await page.locator("[data-chat-root-slot]").count(): break
                await asyncio.sleep(0.5)
            else:
                print("BODY", (await page.locator("body").inner_text())[:1200])
                raise AssertionError("Chat root did not mount")
            await base.grant(page); await base.open_session(page)

            # 1. Same-tab reload restores text and reauthorizes the exact Original from the Host.
            stamp = uuid.uuid4().hex[:12]
            text = f"reload draft {stamp}"
            await page.get_by_label("Message").fill(text)
            await base.upload(page, "reload.png", "image/png", base.data_png())
            await base.wait_original(page, 1)
            await expect(page.locator("[data-chat-draft-ready]")).to_have_attribute("data-chat-draft-ready", "true", timeout=15000)
            before = await journal_lines()
            record = await draft_record(page)
            assert record and record["draft"]["text"] == text and len(record["originals"]) == 1, f"draft record {record}"
            assert await page.evaluate("Object.values(localStorage).some(value => String(value).includes('reload draft'))") is False, "drafts are not browser-wide"
            await page.reload()
            try:
                await page.wait_for_selector("[data-chat-root-slot]", timeout=15000)
            except Exception:
                print("RELOAD_URL", page.url)
                print("RELOAD_BODY", (await page.locator("body").inner_text())[:600])
                print("RELOAD_LOCKS", await page.evaluate("navigator.locks.query().then(q => JSON.stringify(q))"))
                print("RELOAD_STORAGE", await page.evaluate("JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))"))
                raise
            await base.open_session(page)
            await wait_text(page, text)
            await base.wait_original(page, 1)
            assert await page.locator("[data-chat-original-invalid='true']").count() == 0, "Host reauthorized the Original"
            assert await journal_lines() == before, "automatic hydration dispatched no prompt"
            cases.append("same-tab-reload-restores-text-and-host-original")

            # 2. A missing Host Original remains visible as an invalid item; text and Send protection stay.
            record = await draft_record(page)
            object_id = record["originals"][0]["id"]
            removed = None
            for path in (base.DATA / "attachments").rglob("*"):
                if path.is_file() and object_id in path.name:
                    path.unlink(); removed = str(path); break
            assert removed, f"Host Original file for {object_id} not found under {base.DATA}"
            await page.reload()
            try:
                await page.wait_for_selector("[data-chat-root-slot]", timeout=15000)
            except Exception:
                print("RELOAD_URL", page.url)
                print("RELOAD_BODY", (await page.locator("body").inner_text())[:600])
                print("RELOAD_LOCKS", await page.evaluate("navigator.locks.query().then(q => JSON.stringify(q))"))
                print("RELOAD_STORAGE", await page.evaluate("JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))"))
                raise
            await base.open_session(page)
            await wait_text(page, text)
            await expect(page.locator("[data-chat-original-invalid='true']")).to_have_count(1, timeout=15000)
            assert await page.get_by_role("button", name="Send", exact=True).is_disabled(), "an unavailable Original blocks Send"
            assert (await page.get_by_label("Message").input_value()) == text, "the missing Original loses no text"
            cases.append("missing-original-invalid-item-blocks-send")

            # 3. A copied tab inherits sessionStorage but never the draft record or Host scope.
            first = page
            async with context.expect_page() as opened:
                await first.evaluate(f"() => window.open('{base.ORIGIN}/', '_blank')")
            copy = await opened.value
            try:
                await copy.wait_for_selector("[data-chat-root-slot]")
                await base.open_session(copy)
                await expect(copy.locator("[data-chat-draft-ready]")).to_have_attribute("data-chat-draft-ready", "true", timeout=15000)
                assert await copy.get_by_label("Message").input_value() == "", "the copied tab has no inherited draft"
                assert await visible_originals(copy) == 0, "the copied tab has no inherited Original"
                await copy.get_by_label("Message").fill(f"copied tab {stamp}")
                await copy.wait_for_timeout(300)
                await wait_text(first, text)
                assert await visible_originals(first) == 1, "the first tab keeps its own record"
                cases.append("copied-tab-isolated-draft-and-host-scope")
            finally:
                await copy.close()

            # 4. Host restart keeps the same-tab record; a rebuild that cannot present is a recorded boundary.
            await base.stop_host(host); host = await base.start_host()
            await first.reload(); await first.wait_for_selector("[data-chat-root-slot]")
            try:
                await base.open_session(first)
            except Exception as failure:
                boundaries.append(f"projection-unavailable-after-restart: {str(failure)[:160]}")
                record = await draft_record(first)
                assert record and record["draft"]["text"] == text, "the tab record survives Host restart"
            else:
                await wait_text(first, text)
                record = await draft_record(first)
                assert record and record["draft"]["text"] == text, "the tab record survives Host restart"
                await base.wait_original(first, 1)
                cases.append("host-restart-rehydrates-tab-record")
            assert await journal_lines() == before, "restart/hydration never dispatches the draft"
            cases.append("restart-never-dispatches-draft")

            await first.screenshot(path=str(ROOT / "vendor/chat-drafts.png"), full_page=True)
            assert not errors, errors
            await context.close(); await browser.close()
            print(json.dumps({"status": "PASS", "browser": browser.version, "cases": cases,
                              "boundaries": boundaries, "removedOriginal": removed}, indent=2))
    finally:
        await base.stop_host(host)


asyncio.run(main())
