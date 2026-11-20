"""Actual Linux Chromium -> public Chat Host/Remote -> strict native OMP choice/thinking + WebUI scoped appearance."""
import asyncio, json, os, re, shutil, signal, subprocess, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect
ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = ROOT / "vendor/host-chat/chat-component-main.js"
BUTTON = re.compile(r"(Open|Switch) Chat Session")
PORT = int(os.environ.get("OMP_CHAT_PORT", "3198"))

def kill_worker():
    subprocess.run(["pkill", "-f", f"{ROOT}/vendor/omp-candidate/cli.js.*--mode rpc-ui"], check=False)

async def wait_health(timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1); return
        except Exception: await asyncio.sleep(0.1)
    raise RuntimeError("chat Host did not become healthy")

async def main():
    kill_worker(); subprocess.run(["pkill", "-f", str(HOST)], check=False); await asyncio.sleep(0.5)
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True)
    env = {**os.environ, "OMP_CHAT_PORT": str(PORT)}
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env,
        stdout=open(ROOT / "vendor/chat-host.log", "w"), stderr=subprocess.STDOUT)
    errors = []
    try:
        await wait_health()
        link = subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"], cwd=ROOT, env=env, text=True).strip()
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            context = await browser.new_context(); a = await context.new_page()
            a.on("pageerror", lambda error: errors.append(str(error)))
            await a.goto(link); await a.wait_for_selector("[data-chat-root-slot]")
            await a.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
            await a.get_by_role("button", name="Review directory", exact=True).click()
            await a.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
            await a.get_by_role("button", name="Refresh catalog").click()
            await a.locator('li[data-native-id="native-0000"]').get_by_role("button", name=BUTTON).click()
            try:
                await a.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=60000)
            except Exception:
                print("OPEN_ERRORS", errors)
                print("BODY", (await a.locator("body").inner_text())[:1000])
                raise
            try: await a.wait_for_selector('[data-session-settings-revision]', timeout=30000)
            except Exception:
                print("PAGE_ERRORS", errors)
                print("SETTINGS_PANEL", await a.locator("[data-session-settings]").all_inner_texts() if await a.locator("[data-session-settings]").count() else "MISSING")
                raise

            # Scoped WebUI appearance: only this document root changes; values survive reload.
            await expect(a.get_by_label("WebUI theme")).to_have_value("system")
            before = await a.evaluate("() => getComputedStyle(document.querySelector('[data-chat-root-slot]')).backgroundColor")
            await a.get_by_label("WebUI theme").select_option("dark")
            await expect(a.locator("[data-chat-root-slot]")).to_have_attribute("data-om-theme", "dark")
            await expect(a.locator("[data-webui-appearance] [role=status]")).to_contain_text("Saved to this WebUI")
            dark = await a.evaluate("() => getComputedStyle(document.querySelector('[data-chat-root-slot]')).backgroundColor")
            assert before != dark, (before, dark)
            assert await a.evaluate("() => document.documentElement.dataset.omTheme") is None
            await a.get_by_label("WebUI language").fill("zh-CN")
            await a.get_by_role("button", name="Apply language", exact=True).click()
            await expect(a.locator("[data-chat-root-slot]")).to_have_attribute("lang", "zh-CN")
            await expect(a.locator("[data-webui-appearance]")).to_contain_text("外观与语言")
            assert not await a.evaluate("() => Object.keys(localStorage).some(key => key.includes('ui-theme') || key.includes('locale'))")

            options = await a.get_by_label("Session model").locator("option").all_inner_texts()
            levels = await a.get_by_label("Session thinking level").locator("option").all_inner_texts()
            thinking_options_after = levels
            print("MODELS", options); print("THINKING", levels)
            current_model = await a.get_by_label("Session model").input_value()
            current_level = await a.get_by_label("Session thinking level").input_value()
            other_model = next((o for o in await a.get_by_label("Session model").locator("option").evaluate_all("els => els.map(e => e.value)") if o != current_model), None)
            other_level = next((o for o in await a.get_by_label("Session thinking level").locator("option").evaluate_all("els => els.map(e => e.value)") if o != current_level), None)
            assert other_model or other_level, "native Session exposes no alternative model or thinking level"
            revision = await a.locator("[data-session-settings-revision]").get_attribute("data-session-settings-revision")
            captured = []
            a.on("request", lambda request: captured.append(request.post_data) if request.url.endswith("/api/ompSessions/applyPreferences") else None)
            draft = "Draft survives native model and thinking changes."
            await a.get_by_label("Message").fill(draft)
            if other_model: await a.get_by_label("Session model").select_option(other_model)
            if other_level: await a.get_by_label("Session thinking level").select_option(other_level)
            await a.get_by_role("button", name="Apply to this Session", exact=True).click()
            await expect(a.locator("[data-session-settings] [role=status]")).to_contain_text("confirmed the new settings", timeout=30000)
            next_revision = await a.locator("[data-session-settings-revision]").get_attribute("data-session-settings-revision")
            assert int(next_revision) == int(revision) + 1, (revision, next_revision)
            assert await a.get_by_label("Message").input_value() == draft
            assert await a.locator("[data-chat-native-session]").get_by_text("{\"kind\":\"user\",\"seq\":1").count() == 1
            thinking_options_after = await a.get_by_label("Session thinking level").locator("option").evaluate_all("els => els.map(e => e.value)")
            # A reasoning-capable model can expose further native thinking levels; apply one at the new revision.
            if other_level is None:
                later_levels = await a.get_by_label("Session thinking level").locator("option").evaluate_all("els => els.map(e => e.value)")
                later_level = next((o for o in later_levels if o != current_level), None)
                print("THINKING_AFTER_MODEL", later_levels, "revision", next_revision)
                if later_level:
                    revision = next_revision
                    other_level = later_level
                    await a.get_by_label("Session thinking level").select_option(later_level)
                    await a.get_by_role("button", name="Apply to this Session", exact=True).click()
                    await expect(a.locator("[data-session-settings] [role=status]")).to_contain_text("confirmed the new settings", timeout=30000)
                    next_revision = await a.locator("[data-session-settings-revision]").get_attribute("data-session-settings-revision")
                    assert int(next_revision) == int(revision) + 1, (revision, next_revision)

            # Return to the controlled native model, then prove the stream and projection still settle.
            fixture_option = next(o for o in await a.get_by_label("Session model").locator("option").evaluate_all("els => els.map(e => ({value: e.value, text: e.textContent || \"\"}))") if o["text"].startswith("s0-controlled / Controlled fixture"))
            revision = next_revision
            await a.get_by_label("Session model").select_option(fixture_option["value"])
            await a.get_by_role("button", name="Apply to this Session", exact=True).click()
            await expect(a.locator("[data-session-settings] [role=status]")).to_contain_text("confirmed the new settings", timeout=30000)
            next_revision = await a.locator("[data-session-settings-revision]").get_attribute("data-session-settings-revision")
            assert int(next_revision) == int(revision) + 1, (revision, next_revision)
            await a.get_by_label("Message").fill("Stream after native settings")
            await a.get_by_role("button", name="Send", exact=True).click()
            await a.wait_for_timeout(2000)
            await a.wait_for_selector('[data-chat-settlement="settled"]', timeout=60000)
            assert "succeeded" in await a.locator("[data-chat-settlement]").inner_text()
            assert await a.get_by_label("Message").input_value() == ""
            await expect(a.locator("#conversation")).to_contain_text("authoritative controlled final", timeout=30000)

            # The same public RPC refuses a stale revision over Chromium, never a false success.
            assert captured, "no public applyPreferences request was observed"
            stale = await a.evaluate("""async body => {
                const status = await (await fetch("/auth/status")).json();
                const request = JSON.parse(body); request.rpcId = crypto.randomUUID();
                const response = await fetch("/api/ompSessions/applyPreferences", { method: "POST",
                    headers: { "content-type": "application/json", "x-omp-csrf": status.csrf },
                    body: JSON.stringify(request) });
                return { status: response.status, body: await response.text(), replay: request };
            }""", captured[-1])
            assert stale["status"] == 200, stale
            refused = json.loads(stale["body"])
            assert refused["result"]["ok"] is False and refused["result"]["error"]["code"] == "gateway/bad-request", refused
            assert "changed" in refused["result"]["error"]["message"], refused

            await a.reload(); await a.wait_for_selector('[data-chat-native-session="native-0000"]', timeout=60000)
            await a.wait_for_selector('[data-session-settings-revision]', timeout=30000)
            assert await a.locator("[data-chat-root-slot]").get_attribute("data-om-theme") == "dark"
            assert await a.locator("[data-chat-root-slot]").get_attribute("lang") == "zh-CN"
            assert await a.locator("[data-session-settings-revision]").get_attribute("data-session-settings-revision") == next_revision
            final_model = await a.get_by_label("Session model").input_value()
            final_thinking = await a.get_by_label("Session thinking level").input_value()
            assert final_model == fixture_option["value"], (final_model, fixture_option)
            await a.screenshot(path=str(ROOT / "vendor/settings-browser.png"), full_page=True)
            assert not errors, errors
            result = {"status": "PASS", "platform": "Linux Chromium", "browser": browser.version, "realDSH": True,
              "realBun": True, "realStrictNative": True, "modelOptions": options, "thinkingOptions": levels,
              "thinkingOptionsAfterModel": thinking_options_after,
              "modelChanged": other_model is not None, "thinkingChanged": other_level is not None,
              "finalModel": final_model, "finalThinking": final_thinking,
              "revision": next_revision, "scenarios": ["scoped-appearance-dark-zh", "reload-persistence",
                "native-settings-read", "native-settings-apply-readback", "stale-revision-refused",
                "draft-and-history-preserved", "stream-settled-after-settings"],
              "privateData": False, "normalProductAdmission": "blocked", "errors": errors}
            (ROOT / "vendor/settings-browser.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result))
            await context.close(); await browser.close()
    finally:
        kill_worker()
        if host.poll() is None:
            host.send_signal(signal.SIGTERM)
            try: host.wait(timeout=10)
            except subprocess.TimeoutExpired: host.kill(); host.wait()
asyncio.run(main())
