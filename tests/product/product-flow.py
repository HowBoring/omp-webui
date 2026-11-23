"""Final product tuple -> real Linux Chromium -> stock DSH UI -> public Host -> strict native worker.

Controlled provider only (`compatibility/omp/fixtures/live-provider.ts`); never real inference.
Drives the stock DSH shell (no custom full-page client): directory grant, New Session, composer,
Send, Stop, Continue, history reopen, a second view and the native JSONL identity behind them.
"""
import asyncio, json, os, re, shutil, signal, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("chromium") or shutil.which("google-chrome")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
PORT = int(os.environ.get("OMP_PRODUCT_FLOW_PORT", "3206"))
WORK = Path(os.environ.get("OMP_PRODUCT_FLOW_DIR", ROOT / "vendor/product-flow"))
HOME = WORK / "project" / "agent-home"
DATA = WORK / "data"
PROJECT = WORK / "project"
FINAL = "authoritative controlled final"
SESSION = "[data-conversation-session]"
COMPOSER = '[contenteditable="true"][data-phase]'

CONFIG = """extensions:
  - %s
modelRoles:
  default: s0-controlled/deterministic-live
""" % (ROOT / "compatibility/omp/fixtures/live-provider.ts")


def host_env(scenario=None, delay=None):
    env = os.environ.copy()
    manifest = ROOT / "vendor/product/installation.json"
    env.update({
        "OMP_WEB_MANIFEST": str(manifest),
        "OMP_WEB_MANIFEST_SHA256": hashlib_file(manifest),
        "OMP_WEB_LAUNCHER": str(ROOT / "vendor/omp-candidate/omp"),
        "OMP_WEB_PORT": str(PORT),
        "OMP_WEB_ORIGIN": f"http://127.0.0.1:{PORT}",
        "OMP_WEB_DATA_DIR": str(DATA),
        "HOME": str(HOME),
        "PI_CODING_AGENT_DIR": str(HOME),
        "OMP_HISTORY_FIXTURE_PROFILE": str(HOME),
    })
    if scenario:
        env["OMP_LIVE_FIXTURE_SCENARIO"] = scenario
    if delay is not None:
        env["OMP_LIVE_FIXTURE_DELAY_MS"] = str(delay)
    return env


def hashlib_file(path):
    import hashlib
    return hashlib.sha256(path.read_bytes()).hexdigest()


def provider_calls():
    path = HOME / "controlled-provider.json"
    return json.loads(path.read_text()).get("calls") if path.exists() else 0


def health():
    try:
        return urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=1).status == 200
    except Exception:
        return False


def bootstrap(scenario=None, delay=None):
    out = subprocess.check_output([BUN, "--no-env-file", "apps/host/src/main.ts", "--print-bootstrap"],
                                  cwd=ROOT, env=host_env(scenario, delay), text=True)
    return out.strip().splitlines()[-1]


async def start_host(scenario=None, delay=None):
    (ROOT / "vendor/product-flow").mkdir(parents=True, exist_ok=True)
    host = subprocess.Popen([BUN, "--no-env-file", "apps/host/src/main.ts"], cwd=ROOT,
                            env=host_env(scenario, delay), stdout=open(ROOT / "vendor/product-flow/host.log", "w"), stderr=subprocess.STDOUT,
                            start_new_session=True)
    for _ in range(300):
        if health():
            return host
        await asyncio.sleep(0.1)
    host.kill()
    raise RuntimeError("product Host did not become healthy")


async def stop_host(host):
    # The Host starts its native worker in this recorded process group; signalling the group never
    # touches another run's Host or worker on the machine.
    try:
        os.killpg(os.getpgid(host.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        host.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(host.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        host.kill()
    await asyncio.sleep(0.5)


async def grant(page):
    await page.locator("[data-product-directories-toggle]").click()
    await page.get_by_label("Directory to authorize").fill(str(PROJECT))
    await page.get_by_role("button", name="Review directory", exact=True).click()
    await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
    await page.get_by_role("button", name="Refresh grants and catalog").click()
    await page.wait_for_selector('li[data-product-grant][data-product-grant-status="valid"]', timeout=60000)


async def native_session(page, timeout=180000):
    await page.wait_for_function(
        "() => (document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? '') !== ''",
        timeout=timeout)
    return await page.locator(SESSION).first.get_attribute("data-conversation-session")


async def new_session(page, previous=""):
    await page.locator('li[data-product-grant][data-product-grant-status="valid"]').get_by_role(
        "button", name="New Session here", exact=True).click()
    await page.wait_for_function(
        "previous => (document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? '') !== previous",
        arg=previous, timeout=180000)
    return await native_session(page)


async def stock_command(page, checks):
    """Type the stock slash menu, pick a Native command, and let Native consume the bare line."""
    box = await wait_composer(page)
    await box.click()
    await box.type("/")
    await expect(page.get_by_role("listbox")).to_be_visible(timeout=60000)
    await expect(page.get_by_role("option", name=re.compile(r"^context\b")).first).to_be_visible(timeout=60000)
    names = [text.split("\n", 1)[0].strip() for text in await page.get_by_role("option").all_inner_texts()]
    checks["slashCatalog"] = names
    assert "context" in names, "the Native catalog left the stock slash menu"
    assert "Model" in names, "the stock /model contribution left the menu"
    await box.type("cont")
    option = page.get_by_role("option", name=re.compile(r"^context\b"))
    await expect(option.first).to_be_visible(timeout=60000)
    await option.first.click()
    await page.wait_for_function(
        "selector => { const nodes = document.querySelectorAll(selector); const node = nodes[nodes.length - 1];"
        " return node !== undefined && node.innerText.trim() === ''; }",
        arg=COMPOSER, timeout=60000)
    checks["slashCommand"] = "/context"


async def composer(page):
    return page.locator(COMPOSER).last


async def wait_composer(page, timeout=180000):
    box = page.locator(COMPOSER).last
    await expect(box).to_be_visible(timeout=timeout)
    await page.wait_for_function(
        "selector => { const nodes = document.querySelectorAll(selector); const node = nodes[nodes.length - 1];"
        " return node !== undefined && node.getAttribute('aria-disabled') !== 'true'; }",
        arg=COMPOSER, timeout=timeout)
    return box


async def send(page, text, enter=False):
    box = await wait_composer(page)
    await box.fill(text)
    if enter:
        await box.press("Enter")
        return
    await expect(page.get_by_role("button", name="Send message", exact=True)).to_be_enabled(timeout=60000)
    notice = "projection is synchronizing; retry input after it is ready"
    for _ in range(4):
        await page.get_by_role("button", name="Send message", exact=True).click()
        try:
            await page.wait_for_function(
                "([selector, notice]) => {"
                " const nodes = document.querySelectorAll(selector); const node = nodes[nodes.length - 1];"
                " return node !== undefined && (node.innerText.trim() === '' || document.body.innerText.includes(notice)); }",
                arg=[COMPOSER, notice], timeout=15000)
        except PlaywrightTimeoutError:
            pass
        if (await page.locator(COMPOSER).last.inner_text()).strip() == "":
            return
        try:
            await page.wait_for_function(
                "text => !document.body.innerText.includes(text)", arg=notice, timeout=180000)
        except PlaywrightTimeoutError:
            pass
        await wait_composer(page)
    raise RuntimeError("the stock host kept refusing the prompt after projection synchronization")


async def wait_final(page, previous=0, timeout=180000):
    await page.wait_for_function(
        "([text, previous]) => (document.body.innerText.match(new RegExp(text, 'g')) ?? []).length > previous",
        arg=[FINAL, previous], timeout=timeout)
    await wait_composer(page, timeout=timeout)


async def body_final_count(page):
    return (await page.locator("body").inner_text()).count(FINAL)


async def wait_continue(page, timeout=180000):
    await expect(page.get_by_role("button", name="Continue generating", exact=True)).to_be_visible(timeout=timeout)
    await wait_composer(page, timeout=timeout)


async def wait_stopped(page, timeout=180000):
    await expect(page.locator("body")).to_contain_text("Stopped", timeout=timeout)
    await wait_composer(page, timeout=timeout)


async def open_settings(page):
    """Open stock Settings: the shell's own trigger, or the account menu when it owns that slot."""
    direct = page.get_by_role("button", name="Settings", exact=True)
    if await direct.count() > 0:
        await direct.first.click()
        return
    await page.get_by_role("button", name="Account menu", exact=True).first.click()
    await page.get_by_role("menuitem", name="Settings", exact=True).click()


async def phase_linux(browser, errors, scenarios, checks, link):
    context = await browser.new_context()
    page = await context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    await page.goto(link, wait_until="domcontentloaded")
    await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
    await grant(page)
    checks["grantAdmitted"] = True
    native = await new_session(page)
    checks["newSession"] = native
    await stock_command(page, checks)
    await send(page, "final tuple turn one")
    await wait_final(page)
    checks["liveAttachSession"] = await page.locator(SESSION).first.get_attribute("data-conversation-session")
    checks["liveAttachRenderedText"] = FINAL in await page.locator("body").inner_text()
    checks["liveAttachNodes"] = await page.locator(SESSION).count()

    reopened = False
    for attempt in range(3):
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
        try:
            await page.wait_for_function(
                "id => document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') === id",
                arg=native, timeout=40000)
            reopened = True
            break
        except PlaywrightTimeoutError:
            await page.wait_for_timeout(5000)
    checks["historyReopen"] = reopened
    assert reopened, "the stock shell restored the selected native Session after reload"
    await expect(page.locator("body")).to_contain_text(FINAL, timeout=180000)
    checks["historyRenderedText"] = FINAL in await page.locator("body").inner_text()
    checks["historyNodes"] = await page.locator(SESSION).count()
    checks["sessionTree"] = await page.get_by_role("tree").count()
    assert checks["sessionTree"] > 0, "the stock shell renders the Session tree"

    # Model and thinking travel the stock model-picker menu; the effort choice must reach the native worker.
    model_trigger = page.get_by_role("button", name=re.compile(r"^Select model, current "))
    await expect(model_trigger).to_be_visible(timeout=120000)
    checks["modelTrigger"] = await model_trigger.get_attribute("aria-label")
    await model_trigger.click()
    menu = page.get_by_role("menu", name="Model and reasoning effort")
    await expect(menu).to_be_visible(timeout=60000)
    effort_row = menu.get_by_role("menuitem", name=re.compile(r"^Effort"))
    await expect(effort_row).to_be_visible(timeout=60000)
    await effort_row.click()
    labels = [label.strip() for label in await page.get_by_role("menuitemradio").all_inner_texts()]
    current_effort = (checks["modelTrigger"] or "").rsplit("reasoning effort ", 1)[-1]
    target_effort = next((label for label in labels if label not in ("Default", current_effort)), None)
    assert target_effort, f"the stock model picker exposes no alternate reasoning effort: {labels}"
    await page.get_by_role("menuitemradio", name=target_effort, exact=True).click()
    await expect(model_trigger).to_have_attribute(
        "aria-label", re.compile(rf"reasoning effort {re.escape(target_effort)}$"), timeout=120000)
    checks["thinkingLevel"] = target_effort
    scenarios.append("stock-model-thinking")

    # Appearance is a stock Settings surface; the Host must persist the preference across reloads.
    await open_settings(page)
    dark = page.get_by_role("button", name="Dark", exact=True)
    await expect(dark).to_be_visible(timeout=60000)
    await dark.click()
    await expect(dark).to_have_attribute("aria-pressed", "true", timeout=60000)
    await page.keyboard.press("Escape")
    checks["preferenceTheme"] = "dark"
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
    await page.wait_for_function(
        "text => document.body.innerText.includes(text)", arg=FINAL, timeout=180000)
    await open_settings(page)
    await expect(page.get_by_role("button", name="Dark", exact=True)).to_have_attribute(
        "aria-pressed", "true", timeout=60000)
    await page.keyboard.press("Escape")
    checks["preferencePersisted"] = True
    scenarios.append("stock-preferences-reload")

    # A second view of the same stock Session must converge on the same native projection.
    view = await context.new_page()
    view.on("pageerror", lambda error: errors.append(str(error)))
    view.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    await view.goto(f"http://127.0.0.1:{PORT}/", wait_until="domcontentloaded")
    await view.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
    await view.wait_for_function(
        "id => document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') === id",
        arg=native, timeout=120000)
    checks["multiViewSession"] = await view.locator(SESSION).first.get_attribute("data-conversation-session")
    await send(page, "shared view turn")
    await wait_final(page)
    await expect(view.locator("body")).to_contain_text("shared view turn", timeout=120000)
    await expect(view.locator("body")).to_contain_text(FINAL, timeout=120000)
    checks["multiViewLive"] = True
    await view.close()

    # Continue generating is a retryable-failure action; a one-shot flag fails exactly this call.
    (HOME / "retry-fail").write_text("1")
    await send(page, "retryable turn")
    await wait_continue(page)
    checks["retryOffer"] = True
    attempts = provider_calls()
    (HOME / "retry-fail").unlink()
    await page.get_by_role("button", name="Continue generating", exact=True).click()
    await wait_final(page, previous=await body_final_count(page))
    checks["retry"] = provider_calls() - attempts
    scenarios.append("explicit-stock-continue")
    checks["send"] = provider_calls()
    scenarios.append("new-native-session-and-send")

    (HOME / "slow-stream").write_text("1")
    await send(page, "second turn")
    await expect(page.get_by_role("button", name="Stop generating", exact=True).first).to_be_visible(timeout=120000)
    await page.get_by_role("button", name="Stop generating", exact=True).first.click()
    await wait_stopped(page)
    (HOME / "slow-stream").unlink()
    checks["stop"] = "Stopped"
    scenarios.append("stop-settles-stopped")
    await send(page, "after stop")
    await wait_final(page, previous=await body_final_count(page))
    checks["recovery"] = provider_calls()
    scenarios.append("send-after-stop")

    # Stock web:linux declares no session.new default; the sidebar control is the supported path.
    previous = await native_session(page)
    await send(page, "keyboard send turn", enter=True)
    await wait_final(page, previous=await body_final_count(page))
    checks["sendEnter"] = "succeeded"
    await page.keyboard.press("Control+Alt+KeyN")
    await page.wait_for_timeout(1000)
    assert await native_session(page) == previous, "stock web:linux must not invent a custom new-session shortcut"
    checks["newSessionShortcut"] = "unbound on web:linux"
    await page.locator("[data-product-directories-toggle]").click()
    await page.get_by_role("button", name="New Session here", exact=True).click()
    await page.wait_for_function(
        "previous => (document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? '') !== previous",
        arg=previous, timeout=180000)
    checks["newSession"] = await native_session(page)
    scenarios.append("stock-enter-and-new-session-control")
    await context.close()
    return native


def native_session_files():
    return sorted(path for path in HOME.rglob("*.jsonl") if "sessions" in path.parts)


def read_native(files, native):
    target = next((path for path in files if native in path.name), None)
    assert target is not None, f"native Session {native} has no JSONL"
    records = [json.loads(line) for line in target.read_text().splitlines() if line.strip()]
    messages = [record["message"] for record in records if record.get("type") == "message"]
    return target, records, messages


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    PROJECT.mkdir(parents=True)
    HOME.mkdir(parents=True)
    errors, scenarios, checks = [], [], {}
    (HOME / "config.yml").write_text(CONFIG)
    if health():
        raise RuntimeError(f"port {PORT} is already serving; another product Host survived a previous run")
    host = await start_host(delay=2000)
    try:
        link = bootstrap(delay=2000)
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            try:
                native = await phase_linux(browser, errors, scenarios, checks, link)
            except BaseException:
                for open_page in browser.contexts[0].pages if browser.contexts else []:
                    (WORK / "failure-body.txt").write_text(await open_page.locator("body").inner_text())
                raise
            await browser.close()
    finally:
        await stop_host(host)
    files = native_session_files()
    assert files, "the product wrote a native Session under the isolated HOME"
    target, records, messages = read_native(files, native)
    texts = [block.get("text") for message in messages for block in (message.get("content") or []) if block.get("type") == "text"]
    assert "final tuple turn one" in texts, "native JSONL keeps the first user turn"
    assert FINAL in texts, "native JSONL keeps the assistant visible text"
    assert any(message.get("stopReason") == "aborted" and message.get("errorMessage") == "Interrupted by user"
               for message in messages), "native JSONL records the stopped attempt"
    assert any(record.get("type") == "custom"
               and record.get("customType") == "omp.native-control/submission-v1"
               and str(record.get("data", {}).get("submission", {}).get("preparationId", "")).startswith("command-v1:")
               and record["data"]["submission"].get("inputOutcome") == "no_input"
               for record in records), "native JSONL records the stock slash command Native consumed"
    assert any(record.get("type") == "model_change" for record in records), "native JSONL keeps the model identity"
    assert any(record.get("type") == "thinking_level_change" for record in records), "native JSONL keeps the thinking level"
    chosen_level = checks.get("thinkingLevel")
    assert any(record.get("type") == "thinking_level_change" and record.get("thinkingLevel") == chosen_level
               for record in records), f"native JSONL records the stock thinking level {chosen_level}"
    checks["nativeFile"] = str(target.relative_to(ROOT))
    checks["nativeRecords"] = len(records)
    checks["nativeMessages"] = len(messages)
    checks["nativeSessions"] = len(files)
    checks["providerCalls"] = provider_calls()
    checks["consoleErrors"] = errors
    assert checks["newSession"] != native, "the stock new-Session control switched to a new native Session"
    assert not errors, errors
    evidence = {
        "kind": "product-flow",
        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "native": native,
        "scenarios": scenarios,
        "checks": checks,
        "installationManifestSha256": hashlib_file(ROOT / "vendor/product/installation.json"),
        "freeze": "docs/evidence/ticket-63-freeze.json",
        "provider": "compatibility/omp/fixtures/live-provider.ts s0-controlled/deterministic-live (controlled, not real inference)",
    }
    out = Path(os.environ.get("OMP_PRODUCT_FLOW_EVIDENCE", str(WORK / "evidence.json")))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"status": "PASS", "native": native, "scenarios": scenarios, "checks": checks,
                      "evidence": str(out)}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
