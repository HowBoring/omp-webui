"""Actual Chromium -> DSH Connection/Remote -> Bun fixture -> real OMP candidate RPC attachment flow."""
import asyncio, json, os
from playwright.async_api import async_playwright

async def until(check, timeout=120.0, interval=0.05):
    loop = asyncio.get_running_loop(); deadline = loop.time() + timeout; seen = None
    while loop.time() < deadline:
        seen = await check()
        if seen:
            return seen
        await asyncio.sleep(interval)
    raise AssertionError(f"condition not reached; last value {seen!r}")

async def main():
    errors, evidence = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get("ATTACHMENT_CHROMIUM", "/usr/bin/google-chrome-stable"),
            headless=True, args=["--no-sandbox"])
        page = await browser.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto(os.environ["ATTACHMENT_URL"], wait_until="load")
        panel = page.locator("#panel section[data-attachment-phase]")
        state = page.locator("#state")
        async def booted():
            return not (await state.inner_text()).startswith("booting")
        await until(booted)
        text = await state.inner_text()
        assert "attachment_boot_failed" not in text, (text, errors)
        await page.locator("#select").click()
        async def selected():
            return await page.locator("#originals li").count() == 2
        await until(selected)
        assert await panel.get_attribute("data-attachment-phase") == "idle"
        await page.locator("#send").click()
        async def reviewed():
            return await panel.get_attribute("data-attachment-phase") in [
                "awaiting-consent", "submitting", "submitted", "failed", "unresolved"]
        await until(reviewed)
        assert await panel.get_attribute("data-attachment-phase") == "awaiting-consent", errors
        assert await page.locator("#panel article").count() == 2
        await page.locator("#panel section[data-attachment-phase='awaiting-consent'] button").last.click()
        result = page.locator("#result")
        async def admitted():
            return await result.get_attribute("data-status") == "accepted"
        async def submitted():
            return await panel.get_attribute("data-attachment-phase") == "submitted"
        await until(admitted, timeout=180)
        await until(submitted)
        await page.locator("#query").click()
        async def queried():
            return await result.get_attribute("data-status") == "queried"
        await until(queried)
        evidence.append(json.loads(await page.locator("#evidence").inner_text()))
        evidence[0]["commands"] = {"build": "bun --no-env-file apps/attachment-fixture/build.ts",
            "host": "bun --no-env-file apps/host/src/attachment-fixture-main.ts",
            "browser": "ATTACHMENT_URL=http://127.0.0.1:3187/ uv run --quiet --with playwright python3 tests/browser/attachment-browser.py"}
        await browser.close()
    submission, queried = evidence[0]["submission"], evidence[0]["query"]
    assert submission["reservation"] == "committed" and submission["preparation"]["receiptId"]
    assert queried["found"] is True and queried["clientSubmissionId"] == submission["clientSubmissionId"]
    links = [link for relation in queried["relations"] for link in relation.get("attachments") or []]
    assert {link["originalId"] for link in links} == {"original-utf8", "original-png"}, links
    assert all(link["preparedId"] and link["preparedSha256"] for link in links)
    if os.environ.get("ATTACHMENT_EVIDENCE"):
        with open(os.environ["ATTACHMENT_EVIDENCE"], "w") as handle:
            json.dump({"kind": "isolated-attachment-browser", "recordedAt": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc).isoformat(), "chromium": os.environ.get("ATTACHMENT_CHROMIUM",
                "/usr/bin/google-chrome-stable"), "flow": evidence[0]}, handle, indent=2)
            handle.write("\n")
    print(json.dumps({"kind": "isolated-attachment-browser", "build": evidence[0]["build"],
        "receipt": submission["preparation"]["receiptId"], "clientSubmissionId": submission["clientSubmissionId"],
        "inputOutcome": queried["inputOutcome"], "relations": len(queried["relations"]),
        "links": len(links), "errors": errors}))

if __name__ == "__main__":
    asyncio.run(main())
