"""Chromium exercises the built Browser View through published Session and Workspace DSH Remote methods."""
import asyncio
import os
import shutil
import sys
from urllib.parse import urlsplit
from playwright.async_api import Error, async_playwright, expect

CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")


async def main():
    project, = sys.argv[1:]
    link = sys.stdin.readline().strip()
    assert link and all(link not in arg for arg in sys.argv), "Synthetic bootstrap input must use stdin."
    origin = link.split("/?", 1)[0]
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
        context = await browser.new_context()
        page = await context.new_page()
        errors, calls = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: calls.append(urlsplit(request.url).path))
        try:
            response = await page.goto(link)
        except Error:
            raise RuntimeError("Synthetic Browser bootstrap navigation failed.") from None
        assert response and response.ok and page.url == f"{origin}/", "Synthetic Browser bootstrap failed."

        saved = page.get_by_role("region", name="Registered Sessions")
        discovered = page.get_by_role("region", name="Discovered native Sessions")
        await expect(saved.get_by_role("heading", name=project, exact=True)).to_be_visible(timeout=5000)
        await expect(saved.locator("article")).to_have_count(32)
        await expect(discovered.locator("article")).to_have_count(32)
        await expect(discovered.get_by_text("partial", exact=True)).to_be_visible()

        async def saved_page():
            rows = {}
            for article in await saved.locator("article").all():
                rows[await article.get_attribute("data-native-id")] = await article.inner_text()
            return rows

        registered = await saved_page()
        await saved.get_by_role("button", name="Next registered page").click()
        await expect(saved.locator("article")).to_have_count(3)
        registered.update(await saved_page())
        assert len(registered) == 35 and "discovered-only" not in registered, registered.keys()
        assert "Current verified title" in registered["verified"]
        assert "ownership held" in registered["verified"] and "directory authorized" in registered["verified"]
        assert "Cached replacement title" in registered["replaced"] and "replaced" in registered["replaced"]
        assert "SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED" in registered["replaced"]
        assert "Manual Open required. Verify the native identity in discovery." in registered["replaced"]
        assert "directory unknown" in registered["replaced"]
        assert "Cached missing title" in registered["missing"] and "missing" in registered["missing"]
        assert "Unrelated replacement title" not in registered["replaced"]
        await expect(discovered.locator("article")).to_have_count(32)
        await discovered.get_by_role("button", name="Next discovered page").click()
        new = discovered.locator('article[data-native-id="discovered-only"]')
        await expect(new).to_be_visible()
        await expect(discovered.get_by_text("complete", exact=True)).to_be_visible()

        await asyncio.sleep(0.8)
        await expect(saved.locator("article")).to_have_count(3)
        for endpoint in ("/api/ompSessions/catalog", "/api/ompSessions/index", "/api/ompWorkspaces/registered"):
            assert calls.count(endpoint) == 2, calls
        assert "/api/ompSessions/open" not in calls
        await new.get_by_role("button", name="Open Session", exact=True).click()
        await expect(page.get_by_role("alert")).to_contain_text("directory", ignore_case=True)
        await expect(saved.locator("article")).to_have_count(32)
        registered = await saved_page()
        await saved.get_by_role("button", name="Next registered page").click()
        await expect(saved.locator("article")).to_have_count(4)
        registered.update(await saved_page())
        assert "SESSION_DIRECTORY_DENIED" in registered["discovered-only"]
        assert calls.count("/api/ompSessions/open") == 1

        await page.get_by_label("Directory to authorize").fill("unfinished directory draft")
        await page.get_by_role("button", name="Revoke directory").click()
        await expect(page.get_by_label("Directory to authorize")).to_have_value("unfinished directory draft")
        await expect(saved.locator("article")).to_have_count(32)
        assert "directory authorized" not in await saved.inner_text()
        await saved.get_by_role("button", name="Next registered page").click()
        await expect(saved.locator("article")).to_have_count(4)
        assert "directory authorized" not in await saved.inner_text()

        async def check_partial(endpoint, error, healthy):
            pattern = f"**{endpoint}"
            await page.route(pattern, lambda route: route.fulfill(status=503))
            try:
                first_call = calls.count(endpoint)
                await page.get_by_role("button", name="Refresh catalog").click()
                await expect(saved.get_by_role("status")).to_contain_text(error)
                await expect(saved.locator("article")).to_have_count(32)
                await expect(saved.get_by_text(healthy, exact=True).first).to_be_visible()
                await saved.get_by_role("button", name="Next registered page").click(timeout=5000)
                await expect(saved.locator("article")).to_have_count(4)
                await expect(saved.get_by_text(healthy, exact=True).first).to_be_visible()
                await expect(saved.get_by_role("status")).to_contain_text(error)
                assert calls.count(endpoint) == first_call + 1, calls
            finally:
                await page.unroute(pattern)

        await check_partial("/api/ompWorkspaces/registered", "Workspace status unavailable", "Last attempt registered")
        await check_partial("/api/ompSessions/index", "Session attempts unavailable", "Last attempt unavailable")

        delayed = "**/api/ompWorkspaces/registered"
        withheld, release, sent = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def hold_registration(route):
            response = await route.fetch()
            assert response.ok
            withheld.set()
            await release.wait()
            await route.fulfill(response=response)
            sent.set()

        second = await context.new_page()
        await second.goto(origin)
        await page.route(delayed, hold_registration)
        try:
            refresh = page.get_by_role("button", name="Refresh catalog")
            await refresh.click()
            await asyncio.wait_for(withheld.wait(), 5)
            await second.get_by_role("button", name="Log out").click()
            await expect(refresh).to_be_disabled(timeout=5000)
        finally:
            release.set()
        await asyncio.wait_for(sent.wait(), 5)
        await expect(page.get_by_role("alert")).to_contain_text("Browser authorization required")
        await expect(saved.locator("article")).to_have_count(0)
        await expect(discovered.locator("article")).to_have_count(0)
        assert not errors, errors
        print("PASS Chromium Workspace Browser View: status, attempts, partial paging, explicit Open, revoke and logout")
        await browser.close()


asyncio.run(main())
