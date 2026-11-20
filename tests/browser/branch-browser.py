"""Actual Linux Chromium -> DSH Chat client -> typed Remote -> real strict native OMP branch.

Synthetic Chat fixture only. Proves the Branched Session preview/confirm, native identity, atomic
presentation replacement and the unsent returned draft, with no prompt, replay or model call.
"""
import asyncio, json, os, re, shutil, signal, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = ROOT / "vendor/host-chat/chat-component-main.js"
PORT = int(os.environ.get("OMP_BRANCH_PORT", "3195"))
TARGET = "Before reset"
CHAT_BUTTON = re.compile(r"(Open|Switch) Chat Session")


def env():
    value = os.environ.copy()
    value["OMP_CHAT_PORT"] = value["OMP_CHAT_FIXTURE_PORT"] = str(PORT)
    value["OMP_CHAT_FIXTURE_DATA"] = str(ROOT / "vendor/branch-browser-access")
    return value


async def wait_health(timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1)
            return
        except Exception:
            await asyncio.sleep(0.1)
    raise RuntimeError("branch Chat Host did not become healthy")


async def main():
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env(),
                            stdout=open(ROOT / "vendor/branch-host.log", "w"), stderr=subprocess.STDOUT)
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
            page.on("request", observe)
            await page.goto(bootstrap)
            await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
            await page.get_by_role("button", name="Review directory", exact=True).click()
            await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
            await page.get_by_role("button", name="Refresh catalog").click()
            row = page.locator("li[data-native-id]", has_text="Native Tree Session")
            source_id = await row.get_attribute("data-native-id")
            await row.get_by_role("button", name=CHAT_BUTTON).click()
            await page.wait_for_selector(f'[data-chat-native-session="{source_id}"]', timeout=60000)
            section = page.locator("[data-chat-native-session]")
            draft = page.locator("[data-chat-draft]")
            source_generation = await section.get_attribute("data-chat-generation")

            tree = page.locator("[data-chat-tree]")
            await expect(tree).to_be_visible()
            await tree.get_by_role("button", name="Open current tree").click()
            await expect(tree.get_by_text("Complete native tree", exact=True)).to_be_visible(timeout=30000)
            active = tree.get_by_role("region", name="Current active path")
            await expect(active).to_contain_text("Retained history before compaction")
            await expect(active).to_contain_text("Retained history before reset")
            # Exactly one active path, real parents, and only native user points are branchable.
            rendered = await page.evaluate("""() => {
              const tree = document.querySelector('[data-chat-tree]');
              return {
                points: [...tree.querySelectorAll('button[data-chat-branch-point]')].map(button => {
                  const row = button.closest('li') ?? button.parentElement;
                  const label = row.querySelector('button:not([data-chat-branch-point])')?.textContent ?? '';
                  return [button.getAttribute('data-chat-branch-point'), label];
                }),
                rows: tree.querySelectorAll('ol li').length,
                parents: [...tree.querySelectorAll('span')].filter(span => span.textContent?.startsWith('parent: ')).length,
                activePaths: tree.querySelectorAll('[aria-label="Current active path"]').length,
              };
            }""")
            assert rendered["points"], rendered
            assert rendered["activePaths"] == 1, rendered
            for entry, label in rendered["points"]:
                assert "· user ·" in label, (entry, label)
            assert rendered["parents"] >= len(rendered["points"]), rendered
            await expect(active).to_contain_text("Native compaction boundary")
            await page.screenshot(path=str(ROOT / "vendor/branch-browser-tree.png"), full_page=True)

            before_edit = await draft.input_value()
            target = tree.locator("[data-chat-branch-point]").nth(1)
            target_id = await target.get_attribute("data-chat-branch-point")
            await target.click()
            confirmation = page.locator("[data-chat-branch]")
            await expect(confirmation).to_contain_text(f"Target {target_id}")
            await expect(confirmation).to_contain_text("not rolled back")
            await expect(confirmation).to_contain_text("unsent draft")
            await page.screenshot(path=str(ROOT / "vendor/branch-browser-confirm.png"), full_page=True)
            # Cancelling leaves the Session, its generation and the typed input exactly as they were.
            await page.locator("[data-chat-branch-cancel]").click()
            await expect(confirmation).to_have_count(0)
            assert not [path for path in writes if path == "ompSessions/branch"], writes
            assert await draft.input_value() == before_edit
            assert await section.get_attribute("data-chat-generation") == source_generation

            await target.click()
            mark = len(writes)
            await page.locator("[data-chat-branch-confirm]").click()
            notice = page.locator("[data-chat-branch-notice]")
            await expect(notice).to_contain_text("created at", timeout=60000)
            branched_id = await section.get_attribute("data-chat-native-session")
            generation = await section.get_attribute("data-chat-generation")
            assert branched_id and branched_id != source_id, (branched_id, source_id)
            assert generation != source_generation
            attempted = [path for path in writes[mark:]
                         if path in ("ompSessions/branch", "session/prompt", "session/cancel")]
            assert attempted == ["ompSessions/branch"], writes[mark:]
            assert not [path for path in writes if path in ("session/prompt", "session/cancel")], writes
            # Returned text is an unsent draft: it is in the composer, not in the conversation.
            await expect(draft).to_have_value(TARGET)
            await expect(page.locator("#conversation")).not_to_contain_text(TARGET)
            await expect(notice).to_contain_text("unsent draft")
            # The destination keeps only the common native history through the selected parent.
            destination = page.locator("[data-chat-tree]")
            await destination.get_by_role("button", name="Open current tree").click()
            await expect(destination.get_by_text("Complete native tree", exact=True)).to_be_visible(timeout=30000)
            retained = await destination.get_by_role("button", name=re.compile(r"· user ·")).count()
            assert retained == 2, retained
            await expect(destination).not_to_contain_text("Current question")
            await expect(destination).not_to_contain_text(TARGET)
            await page.screenshot(path=str(ROOT / "vendor/branch-browser-destination.png"), full_page=True)
            # Both Sessions stay known; a reload rebuilds the new one from native identity and keeps the draft.
            await expect(page.locator(f'li[data-native-id="{source_id}"]')).to_have_count(1)
            await expect(page.locator(f'li[data-native-id="{branched_id}"]')).to_have_count(1)
            await page.reload()
            try:
                await page.wait_for_selector(f'[data-chat-native-session="{branched_id}"]', timeout=60000)
            except Exception:
                (ROOT / "vendor/branch-reload.html").write_text(await page.content())
                await page.screenshot(path=str(ROOT / "vendor/branch-reload.png"), full_page=True)
                print(await page.locator("body").inner_text())
                raise
            await expect(page.locator("[data-chat-draft]")).to_have_value(TARGET)
            assert not [path for path in writes if path in ("session/prompt", "session/cancel")], writes
            assert not errors, errors
            result = {"status": "PASS", "platform": "Linux Chromium", "browser": browser.version,
                      "realDSH": True, "realBun": True, "realHost": True, "realOmpWorker": True,
                      "cases": {"nativeUserPointsOnly": "PASS", "toolSpecialCompactionResetRendering": "PASS",
                                "previewBeforeBranch": "PASS", "confirmCancelKeepsInput": "PASS",
                                "nativeIdentityVerified": "PASS", "atomicPresentationReplacement": "PASS",
                                "unsentReturnedDraft": "PASS", "commonHistoryOnly": "PASS",
                                "sourceAndDestinationKnown": "PASS", "reloadRebuildsNewSession": "PASS",
                                "noReplayPromptOrModelCall": "PASS"},
                      "sourceSession": source_id, "branchedSession": branched_id, "targetEntry": target_id,
                      "privateData": False, "productAdmission": "blocked", "branchWrites": attempted}
            (ROOT / "vendor/branch-browser.json").write_text(json.dumps(result, indent=2) + "\n")
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
