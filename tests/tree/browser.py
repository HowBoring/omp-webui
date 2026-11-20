"""Actual Linux Chromium -> real DSH Chat client -> public ompTree/read -> real native OMP worker.

Synthetic S2 fixture only. Proves the read-only Tree does not send input, write history, or call a model.
"""
import asyncio, json, os, re, shutil, signal, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = ROOT / "vendor/host-chat/chat-component-main.js"
PORT = int(os.environ.get("OMP_TREE_PORT", "3189"))
CHAT_BUTTON = re.compile(r"(Open|Switch) Chat Session")


def env():
    value = os.environ.copy()
    value["OMP_CHAT_PORT"] = value["OMP_CHAT_FIXTURE_PORT"] = str(PORT)
    value["OMP_CHAT_FIXTURE_DATA"] = str(ROOT / "vendor/tree-browser-access")
    return value


async def wait_health(timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1)
            return
        except Exception:
            await asyncio.sleep(0.1)
    raise RuntimeError("tree Chat Host did not become healthy")


async def main():
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env(),
                            stdout=open(ROOT / "vendor/tree-host.log", "w"), stderr=subprocess.STDOUT)
    browser = None
    try:
        await wait_health()
        bootstrap = subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"],
                                            cwd=ROOT, env=env(), text=True).strip()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
            page = await browser.new_page()
            errors, writes = [], []

            def observe(request):
                if request.method == "POST" and "/api/" in request.url:
                    writes.append(request.url.split("/api/", 1)[1])
            page.on("pageerror", lambda error: errors.append(str(error)))
            async def log_response(response):
                if "/api/" in response.url and (response.status >= 400 or response.request.method == "POST"):
                    try:
                        body = (await response.text())[:400]
                    except Exception:
                        body = "<no body>"
                    print("RPC", response.status, response.url.split("/api/", 1)[-1], body.replace("\n", " "))
            page.on("response", log_response)
            page.on("request", observe)
            await page.goto(bootstrap)
            await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
            await page.get_by_role("button", name="Review directory", exact=True).click()
            await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
            await page.get_by_role("button", name="Refresh catalog").click()
            row = page.locator("li[data-native-id]", has_text=os.environ.get("TREE_SESSION", "Native Tree Session"))
            native_id = await row.get_attribute("data-native-id")
            await row.get_by_role("button", name=CHAT_BUTTON).click()
            try:
                await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=60000)
            except Exception:
                print("ALERTS", [await e.inner_text() for e in await page.locator("[role=alert]").all()])
                print("ROW", await row.inner_text())
                raise
            conversation = await page.locator("#conversation").inner_text()

            tree = page.locator('[data-chat-tree]')
            await expect(tree).to_be_visible()
            await tree.get_by_role("button", name="Open current tree").click()
            await expect(tree.get_by_text("Complete native tree", exact=True)).to_be_visible(timeout=30000)
            active = tree.get_by_role("region", name="Current active path")
            await expect(active).to_contain_text("Retained history before compaction")
            await expect(active).to_contain_text("Retained history before reset")
            retired = active.locator("details").first
            await expect(retired).not_to_have_attribute("open", "")
            await retired.locator("summary").click()
            retained = retired.get_by_role("button").first
            await expect(retained).to_be_visible()
            await retained.click()
            await expect(tree.get_by_role("region", name="Selected node preview")).to_contain_text("Earlier retained question")
            await expect(active).to_contain_text("Native reset boundary")
            await page.screenshot(path=str(ROOT / "vendor/tree-browser.png"), full_page=True)

            before = len(writes)
            await tree.get_by_role("button", name=re.compile("compaction")).first.click()
            preview = tree.get_by_role("region", name="Selected node preview")
            await expect(preview).to_contain_text("Synthetic native summary")
            await expect(tree).to_contain_text("not an exact model-input audit")
            assert await page.locator("#conversation").inner_text() == conversation, "tree preview changed Chat"
            preview_writes = writes[before:]
            assert all(path == "ompTree/read" for path in preview_writes), preview_writes
            assert not [path for path in writes if path in ("session/prompt", "session/cancel")], writes
            assert not errors, errors
            result = {"status": "PASS", "platform": "Linux Chromium", "browser": browser.version,
                      "realDSH": True, "realBun": True, "realHost": True, "realOmpWorker": True,
                      "cases": {"fullNativeTree": "PASS", "activePathAndFoldedRetainedSegments": "PASS",
                                "nativeCompactionAndResetBoundaries": "PASS", "previewReadOnly": "PASS",
                                "previewSendsNoInputHistoryWriteOrModelCall": "PASS", "chatProjectionUnchanged": "PASS"},
                      "privateData": False, "productAdmission": "blocked", "previewWrites": preview_writes}
            (ROOT / "vendor/tree-browser.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps({key: result[key] for key in ("status", "cases", "privateData", "productAdmission")}))
            await browser.close()
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass
        subprocess.run(["pkill", "-f", re.escape(f"{ROOT}/vendor/omp-candidate/cli.js") + ".*--mode rpc-ui"], check=False)
        if host.poll() is None:
            host.send_signal(signal.SIGTERM)
            try:
                host.wait(timeout=10)
            except subprocess.TimeoutExpired:
                host.kill()
                host.wait(timeout=5)


asyncio.run(main())
