"""Host restart over the real product tuple: SIGTERM + relaunch, no automatic reopen or replay,
the typed manual-open marker, and a working explicit Open that loads the real native history.

Controlled provider only (`compatibility/omp/fixtures/live-provider.ts`); never real inference.
"""
import asyncio, importlib.util, json, os, shutil, time
from pathlib import Path
from playwright.async_api import async_playwright, expect
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
_spec = importlib.util.spec_from_file_location("product_flow", HERE / "product-flow.py")
flow = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(flow)

TURN = "restart recovery turn one"
MARKER = "SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED"


async def attempt(page, native):
    row = page.locator(f'li[data-product-session="{native}"]')
    await expect(row).to_be_visible(timeout=60000)
    return await row.get_attribute("data-product-session-attempt"), row


async def main():
    shutil.rmtree(flow.WORK, ignore_errors=True)
    flow.PROJECT.mkdir(parents=True)
    flow.HOME.mkdir(parents=True)
    (flow.HOME / "config.yml").write_text(flow.CONFIG)
    errors, checks = [], {}
    if flow.health():
        raise RuntimeError(f"port {flow.PORT} is already serving; another product Host survived a previous run")
    checks["installationManifestSha256"] = flow.hashlib_file(ROOT / "vendor/product/installation.json")
    host = await flow.start_host(delay=2000)
    try:
        link = flow.bootstrap(delay=2000)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=flow.CHROME, headless=True, args=["--no-sandbox"])
            context = await browser.new_context()
            page = await context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            try:
                await page.goto(link, wait_until="domcontentloaded")
                await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
                await flow.grant(page)
                native = await flow.new_session(page)
                checks["native"] = native
                await flow.send(page, TURN)
                await flow.wait_final(page, previous=0)
                checks["beforeRestart"] = {"finals": await flow.body_final_count(page),
                                            "providerCalls": flow.provider_calls()}
                # The browser keeps its credential; the Host is what restarts (real SIGTERM, same data dir).
                await flow.stop_host(host)
                host = await flow.start_host(delay=2000)
                link = flow.bootstrap(delay=2000)
                await page.goto(link, wait_until="domcontentloaded")
                await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
                # Nothing reopens or replays on its own: no worker, no provider call, no rendered turn.
                await page.wait_for_timeout(5000)
                body = await page.locator("body").inner_text()
                assert TURN not in body, "the restarted Host replayed the interrupted turn"
                assert flow.FINAL not in body, "the restarted Host auto-opened the worker"
                assert flow.provider_calls() == checks["beforeRestart"]["providerCalls"], "the restarted Host called the provider"
                await page.locator("[data-product-sessions-toggle]").click()
                state, row = await attempt(page, native)
                checks["restartAttempt"] = state
                assert state == MARKER, state
                assert await page.get_by_text("Nothing is replayed", exact=False).count() >= 1
                await row.locator("button[data-product-open-session]").click()
                try:
                    await expect(page.locator("body")).to_contain_text(flow.FINAL, timeout=90000)
                    checks["recovery"] = "in-place"
                except PlaywrightTimeoutError:
                    await page.reload(wait_until="domcontentloaded")
                    await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
                    await expect(page.locator("body")).to_contain_text(flow.FINAL, timeout=120000)
                    checks["recovery"] = "relaunch-link"
                text = await page.locator("body").inner_text()
                assert text.count(flow.FINAL) == 1, "the reopened history repeated the assistant turn"
                assert text.count(TURN) == 1, "the reopened history repeated the user turn"
                assert flow.provider_calls() == checks["beforeRestart"]["providerCalls"], "reopening replayed the operation"
                await page.get_by_role("button", name="Close Sessions").click()
                await page.locator("[data-product-sessions-toggle]").click()
                refreshed, _ = await attempt(page, native)
                checks["afterReopenAttempt"] = refreshed
                assert refreshed.split(":", 1)[0] == "open", refreshed
                await context.close()
            except BaseException:
                for open_page in browser.contexts[0].pages if browser.contexts else []:
                    (flow.WORK / "failure-body.txt").write_text(await open_page.locator("body").inner_text())
                raise
            finally:
                await browser.close()
    finally:
        await flow.stop_host(host)
    target, records, messages = flow.read_native(flow.native_session_files(), checks["native"])
    users = [message for message in messages if message.get("role") == "user"]
    texts = [block.get("text") for message in users for block in (message.get("content") or []) if block.get("type") == "text"]
    assert texts.count(TURN) == 1, "the native JSONL kept exactly one interrupted turn"
    checks["nativeRecords"] = len(records)
    checks["nativeMessages"] = len(messages)
    # The SIGTERM closes the live mux socket under the open page; that reset is the restart itself,
    # not an application error, so it is recorded separately from unexpected console errors.
    def transport_reset(error):
        return "ERR_CONNECTION_RESET" in error or ("/api/remote.mux" in error and "failed" in error)
    checks["restartTransportResets"] = [error for error in errors if transport_reset(error)]
    checks["consoleErrors"] = [error for error in errors if not transport_reset(error)]
    assert not checks["consoleErrors"], checks["consoleErrors"]
    evidence = {"kind": "product-restart-flow", "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "checks": checks, "nativeFile": str(target),
                "scenarios": ["stock-restart-no-auto-open", "stock-restart-manual-open-retained-history"],
                "provider": "compatibility/omp/fixtures/live-provider.ts s0-controlled/deterministic-live (controlled, not real inference)"}
    out = Path(os.environ.get("OMP_PRODUCT_RESTART_EVIDENCE", str(flow.WORK / "restart-evidence.json")))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"status": "PASS", **evidence}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
