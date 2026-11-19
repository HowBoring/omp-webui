"""Actual Linux Chromium -> DSH typed Remote -> Bun -> real strict worker navigation. Synthetic data only."""
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

PORT = os.environ.get("OMP_NAVIGATION_FIXTURE_PORT", "3186")
BUN = os.environ.get("BUN", "bun")


def fixture_stage() -> str | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1) as response:
            return json.load(response).get("fixture")
    except OSError:
        return None


def start_fixture() -> subprocess.Popen[bytes]:
    child = subprocess.Popen([BUN, "vendor/host-navigation/navigation-fixture-main.js"],
        env={**os.environ, "OMP_NAVIGATION_FIXTURE_PORT": PORT},
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(child.stderr.read().decode()[-4000:] if child.stderr else "fixture exited")
        stage = fixture_stage()
        if stage == "idle":
            return child
        if stage == "failed":
            raise RuntimeError("fixture worker failed to start")
        time.sleep(0.2)
    child.terminate()
    raise TimeoutError("fixture did not become idle")


async def main() -> None:
    evidence = Path("vendor/navigation-browser-evidence")
    evidence.mkdir(parents=True, exist_ok=True)
    fixture = start_fixture()
    try:
        await flow(evidence)
    finally:
        fixture.terminate()
        fixture.wait(timeout=15)


async def flow(evidence: Path) -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
        page = await browser.new_page()
        await page.goto(f"http://127.0.0.1:{PORT}")
        await page.wait_for_selector('#tree[data-status="idle"]', timeout=60_000)
        before = await page.locator("#tree li[data-active='true']").last.get_attribute("data-entry")
        # Pick the first user history point, exactly like a person choosing where to branch from.
        await page.locator("#tree li[data-role='user'] button").last.click()
        await page.locator("#inspect").click()
        await page.wait_for_selector('#detail[data-status="confirmation"]')
        confirmation = await page.locator("#detail").inner_text()
        assert "options native_defaults" in confirmation
        await page.locator("#confirm").click()
        await page.wait_for_selector('#detail[data-status="operation"], #detail[data-status="error"]', timeout=30_000)
        if await page.locator("#detail").get_attribute("data-status") == "error":
            raise AssertionError(await page.locator("#detail").inner_text())
        await page.wait_for_selector('#detail[data-outcome="committed"]')
        detail = page.locator("#detail")
        committed_leaf = await detail.get_attribute("data-actual-leaf-id")
        commit_id = await detail.get_attribute("data-commit-id")
        assert committed_leaf and commit_id
        # AC2: no new prompt and no exit marker; kill the worker the moment the commit reply is visible.
        await page.locator("#crash").click()
        await page.wait_for_selector('#tree[data-status="crashed"]', state="attached")
        await page.locator("#reopen").click()
        await page.wait_for_selector("#summary:has-text('reopened')", timeout=60_000)
        await page.wait_for_selector('#detail[data-outcome="committed"]')
        recovered_leaf = await page.locator("#tree li[data-active='true']").last.get_attribute("data-entry")
        queried = await detail.inner_text()
        assert recovered_leaf == committed_leaf, (recovered_leaf, committed_leaf)
        assert recovered_leaf != before
        assert "committed" in queried
        record = {
            "kind": "browser-durable-navigation",
            "session": await page.locator("#state").inner_text(),
            "before": before, "commitId": commit_id, "actualLeafId": committed_leaf,
            "confirmation": confirmation, "operation": queried,
            "reopenedActive": recovered_leaf, "match": True,
            "admission": "synthetic-fixture-only",
            "stopSnapshot": "fixture-adapter", "projection": "fixture-adapter",
        }
        (evidence / "browser.json").write_text(json.dumps(record, indent=2) + "\n")
        assert "Private Session" not in await page.content()
        await browser.close()
        print(json.dumps({k: record[k] for k in ("kind", "match", "actualLeafId", "reopenedActive")}))


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
