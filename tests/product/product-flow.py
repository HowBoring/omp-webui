"""Final product tuple -> real Linux Chromium -> public product Host -> strict native worker.

Controlled provider only (`compatibility/omp/fixtures/live-provider.ts`); never real inference.
Covers the scenarios ticket 59 recorded on an older patch set: new Session, send, Stop, retry.

Status on the ticket-61 combination: new Session and send/stream pass; the Stop and retry phases do not
finish inside the deadline on this Host (the composer stays disabled between phases), so
`docs/evidence/ticket-61-platforms.json` records them as NOT RUN rather than inheriting ticket 59.
"""
import asyncio, json, os, shutil, signal, subprocess, sys, time, urllib.request
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
LINUX_WEB_MAC = "Control+Alt+Enter"

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
    await page.get_by_label("Directory to authorize").fill(str(PROJECT))
    await page.get_by_role("button", name="Review directory", exact=True).click()
    await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
    await page.get_by_role("button", name="Refresh grants and catalog").click()
    await page.wait_for_selector('li[data-product-grant][data-product-grant-status="valid"]', timeout=60000)


async def new_session(page):
    await page.locator('li[data-product-grant][data-product-grant-status="valid"]').get_by_role(
        "button", name="New Session here", exact=True).click()
    await page.wait_for_function(
        "() => (document.querySelector('[data-chat-native-session]')?.getAttribute('data-chat-native-session') ?? '') !== ''",
        timeout=180000)
    return await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session")


async def send(page, text):
    await expect(page.get_by_label("Message")).to_be_enabled(timeout=180000)
    await page.get_by_label("Message").fill(text)
    await page.wait_for_selector('[data-chat-draft-ready="true"]', state="attached", timeout=60000)
    await page.get_by_role("button", name="Send", exact=True).click()


async def settle(page, outcome="succeeded"):
    await expect(page.locator("[data-chat-settlement]")).to_contain_text(outcome, timeout=120000)


async def streaming(page):
    await expect(page.locator("[data-chat-settlement]")).to_have_attribute(
        "data-chat-settlement", "running", timeout=120000)


async def phase_linux(browser, errors, scenarios, checks, link):
    context = await browser.new_context()
    page = await context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    async def dump(response):
        try:
            body = (await response.body())[:400].decode("utf-8", "replace")
        except Exception:
            body = "<unavailable>"
        print("HTTP", response.status, response.request.method, response.url[:90], body, flush=True)

    def trace(response):
        if response.request.method == "POST" or response.status >= 400:
            asyncio.ensure_future(dump(response))
    page.on("response", trace)
    page.on("requestfailed", lambda request: print("FAILED", request.url[:120], request.failure, flush=True))
    wslog = open("/tmp/t61-ws.log", "a")
    page.on("websocket", lambda socket: socket.on("framesent", lambda payload: print("WS>", str(payload)[:200], flush=True))
            or socket.on("framereceived", lambda payload: wslog.write(str(payload) + "\n")))
    page.on("console", lambda message: print("CONSOLE", message.type, message.text[:400], flush=True)
            if message.type == "error" else None)
    await page.goto(link, wait_until="domcontentloaded")
    await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
    await grant(page)
    checks["grantAdmitted"] = True
    native = await new_session(page)
    checks["newSession"] = native
    await send(page, "final tuple turn one")
    await settle(page)
    checks["liveAttachNodes"] = await page.locator("#conversation").get_attribute("data-chat-history-nodes")
    checks["liveAttachRenderedText"] = "authoritative controlled final" in await page.locator("body").inner_text()
    await expect(page.locator("body")).to_contain_text("authoritative controlled final", timeout=180000)
    reopened = False
    for attempt in range(3):
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_function("() => document.title === 'OMP WebUI'", timeout=60000)
        try:
            await page.wait_for_function(
                "() => (document.querySelector('[data-chat-native-session]')?.getAttribute('data-chat-native-session') ?? '') !== ''",
                timeout=40000)
            reopened = True
            break
        except PlaywrightTimeoutError:
            await page.wait_for_timeout(5000)
    checks["historyReopen"] = reopened
    if reopened:
        await expect(page.locator("body")).to_contain_text("authoritative controlled final", timeout=180000)
        checks["historyNodes"] = await page.locator("#conversation").get_attribute("data-chat-history-nodes")
    checks["send"] = provider_calls()
    scenarios.append("new-native-session-and-send")
    await page.get_by_label("Message").fill("second turn")
    await send(page, "second turn")
    await streaming(page)
    await page.get_by_role("button", name="Stop", exact=True).click()
    await settle(page, "cancelled")
    checks["stop"] = "cancelled"
    scenarios.append("stop-settles-cancelled")
    await page.locator("[data-chat-retry-offer]").click(timeout=60000)
    await page.locator("[data-chat-retry-confirm]").click()
    await page.wait_for_selector('[data-chat-retry-attempt][data-chat-retry-settled="true"]', state="attached", timeout=180000)
    attempt = await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-attempt")
    checks["retry"] = attempt
    scenarios.append(f"explicit-confirmed-native-retry:{attempt}")
    await expect(page.get_by_label("Message")).to_be_enabled(timeout=120000)
    await send(page, "after retry")
    await settle(page, "succeeded")
    checks["recovery"] = provider_calls()
    scenarios.append("send-after-retry")
    await send(page, "chord stop turn")
    await streaming(page)
    await page.keyboard.press("Control+Alt+KeyK")
    await settle(page, "cancelled")
    checks["stopChord"] = "cancelled"
    await page.keyboard.press("Control+Alt+KeyR")
    await page.wait_for_selector('[data-chat-retry-attempt][data-chat-retry-settled="true"]', state="attached", timeout=180000)
    checks["retryChord"] = await page.locator("[data-chat-retry-attempt]").get_attribute("data-chat-retry-attempt")
    await expect(page.get_by_label("Message")).to_be_enabled(timeout=120000)
    await page.get_by_label("Message").fill("chord send turn")
    await page.wait_for_selector('[data-chat-draft-ready="true"]', state="attached", timeout=60000)
    await page.keyboard.press(LINUX_WEB_MAC)
    await settle(page, "succeeded")
    checks["sendChord"] = "succeeded"
    previous = await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session")
    await page.keyboard.press("Control+Alt+KeyN")
    await page.wait_for_function(
        "previous => document.querySelector('[data-chat-native-session]')?.getAttribute('data-chat-native-session') !== previous",
        arg=previous, timeout=180000)
    checks["newSessionChord"] = await page.locator("[data-chat-native-session]").get_attribute("data-chat-native-session")
    scenarios.append("linux-web-keymap-chords")
    await context.close()
    return native


def native_session_files():
    return sorted(path for path in HOME.rglob("*.jsonl") if "sessions" in path.parts)


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    PROJECT.mkdir(parents=True)
    HOME.mkdir(parents=True)
    errors, scenarios, checks = [], [], {}
    (HOME / "config.yml").write_text(CONFIG)
    if health():
        raise RuntimeError(f"port {PORT} is already serving; another product Host survived a previous run")
    host = await start_host(delay=1200)
    try:
        link = bootstrap(delay=1200)
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
    checks["nativeFile"] = str(files[0].relative_to(ROOT))
    checks["providerCalls"] = provider_calls()
    checks["consoleErrors"] = errors
    assert not errors, errors
    print(json.dumps({"status": "PASS", "native": native, "scenarios": scenarios, "checks": checks}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
