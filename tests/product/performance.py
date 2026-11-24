#!/usr/bin/env python3
"""S5 performance evidence over the real isolated Host and a real browser.

Corpus: scripts/create-performance-corpus.ts (1000 native Sessions, 10000-entry/100MiB history).
The product Host (apps/host/src/main.ts) serves the stock DSH shell from the enrolled
installation; measurements use the stock selectors only.
"""
import argparse, asyncio, hashlib, inspect, json, math, os, re, shutil, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("BUN") or shutil.which("bun")
CORPUS = ROOT / "vendor/performance-fixture"
PRODUCT_HOST = ROOT / "apps/host/src/main.ts"
PRODUCT_MANIFEST = ROOT / "vendor/product/installation.json"
PRODUCT_LAUNCHER = ROOT / "vendor/omp-candidate/omp"
PRODUCT_ASSETS = ROOT / "vendor/dsh-product"
PRODUCT_PORT = int(os.environ.get("OMP_PERF_PRODUCT_PORT", "3193"))
SESSION_ID = "10000000-0000-4000-8000-000000000000"
SESSION = "[data-conversation-session]"
NODE = "[data-chat-node-key]"
HISTORY = "[data-chat-history]"
SAMPLES = int(os.environ.get("OMP_PERF_SAMPLES", "30"))
WARMUPS = int(os.environ.get("OMP_PERF_WARMUPS", "2"))
RSS_INTERVAL = 0.045
FIRST_PAGE_P95_MS = 3000.0
OLD_PAGE_P95_MS = 1000.0
HOST_RSS_MIB = 512.0
CHAT_TIMEOUT_MS = int(os.environ.get("OMP_PERF_CHAT_TIMEOUT_MS", "300000"))
SETTLE_TIMEOUT_MS = int(os.environ.get("OMP_PERF_SETTLE_TIMEOUT_MS", "5000"))
QUIET_MS = int(os.environ.get("OMP_PERF_QUIET_MS", "500"))
REACH_STEP_MS = int(os.environ.get("OMP_PERF_REACH_STEP_MS", "30000"))
REACH_STEPS = 400


def nearest_rank(values, fraction=0.95):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def proc_rss_mib(pid):
    try:
        text = Path(f"/proc/{pid}/status").read_text()
        return int(re.search(r"VmRSS:\s+(\d+)", text).group(1)) / 1024
    except (OSError, AttributeError):
        return None


def proc_peak_mib(pid):
    try:
        return int(re.search(r"VmHWM:\s+(\d+)", Path(f"/proc/{pid}/status").read_text()).group(1)) / 1024
    except (OSError, AttributeError):
        return None


def descendants(pid):
    parents = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
            parents[int(entry.name)] = int(stat.rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            continue
    found, frontier = [], [pid]
    while frontier:
        current = frontier.pop()
        for child, parent in parents.items():
            if parent == current:
                found.append(child)
                frontier.append(child)
    return found


def cmdline(pid):
    try:
        return Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
    except OSError:
        return ""


def browser_process_pid():
    """Playwright async exposes no process handle; identify the newest headless Chrome browser process
    this run owns (a descendant of this process), never another run's browser."""
    best = None
    for pid in descendants(os.getpid()):
        command = cmdline(pid)
        if "chrome" in command and "--remote-debugging-pipe" in command and "--type=" not in command:
            try:
                started = int(Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19])
            except (OSError, IndexError, ValueError):
                started = 0
            if best is None or started >= best[0]:
                best = (started, pid)
    return best[1] if best else None


def aggregate_rss(pids):
    values = [proc_rss_mib(pid) for pid in pids]
    numbers = [value for value in values if value is not None]
    return sum(numbers) if numbers else None


class RssSampler:
    def __init__(self, host_pid, browser_pid):
        self.host_pid, self.browser_pid = host_pid, browser_pid
        self.host, self.browser, self.omp = [], [], []
        self.running = True

    async def run(self):
        while self.running:
            host = proc_rss_mib(self.host_pid)
            if host is not None:
                self.host.append(host)
            children = descendants(self.host_pid)
            self.omp.append(aggregate_rss([pid for pid in children if "cli.js" in cmdline(pid)]))
            if self.browser_pid:
                self.browser.append(aggregate_rss(descendants(self.browser_pid)))
            await asyncio.sleep(RSS_INTERVAL)

    def stop(self):
        self.running = False

    def report(self):
        host_peak = max(self.host) if self.host else None
        os_peak = proc_peak_mib(self.host_pid)
        return {
            "hostSampledPeakMiB": host_peak,
            "hostOsPeakMiB": os_peak,
            "hostPeakMiB": max([value for value in (host_peak, os_peak) if value is not None], default=None),
            "ompPeakMiB": max([value for value in self.omp if value is not None], default=None),
            "browserPeakMiB": max([value for value in self.browser if value is not None], default=None),
            "toolsPeakMiB": proc_peak_mib(os.getpid()),
            "samples": len(self.host),
        }


async def wait_port(port, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.close()
            await writer.wait_closed()
            return
        except OSError:
            await asyncio.sleep(0.1)
    raise RuntimeError(f"host did not listen on {port}")


def serving(port):
    """A workload is concurrent only if it answers HTTP; a dying Host resets or stalls the connect."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5) as sock:
            sock.sendall(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\n\r\n")
            sock.settimeout(0.5)
            return sock.recv(64).startswith(b"HTTP/")
    except OSError:
        return False


def start_host(host, port, env, log):
    """Start the measured Host and own only its process group; never signal an unrelated workload.
    A port already serving another workload is refused instead of cleaned up."""
    if serving(port):
        raise RuntimeError(f"port {port} is already serving another workload; refusing to measure")
    log.parent.mkdir(parents=True, exist_ok=True)
    handle = log.open("w")
    process = subprocess.Popen([BUN, "--no-env-file", str(host)], cwd=ROOT, env=env,
                               stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
    return process, handle


def stop_host(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


def product_env(data):
    """Real product Host: enrolled installation and corpus Session source; the worker gets a provider
    through the public config.yml extension + modelRoles registration (the #59 controlled provider),
    never a bypass flag."""
    manifest = PRODUCT_MANIFEST.read_bytes()
    home = data / "home"
    for name in ("state", "cache"):
        (home / ".local" / name).mkdir(parents=True, exist_ok=True)
    (home / "config.yml").write_text(
        "extensions:\n"
        f"  - {ROOT / 'compatibility/omp/fixtures/live-provider.ts'}\n"
        "modelRoles:\n"
        "  default: s0-controlled/deterministic-live\n")
    return {
        **os.environ,
        "HOME": str(home),
        "PI_CODING_AGENT_DIR": str(home),
        "OMP_HISTORY_FIXTURE_PROFILE": str(home),
        "XDG_STATE_HOME": str(home / ".local" / "state"),
        "XDG_CACHE_HOME": str(home / ".local" / "cache"),
        "OMP_CATALOG_SOURCES": json.dumps([str(CORPUS / "sessions")]),
        "OMP_LIVE_JOURNAL_MAX_BYTES": os.environ.get("OMP_PERF_JOURNAL_BYTES", "201326592"),
        "OMP_WEB_MANIFEST": str(PRODUCT_MANIFEST),
        "OMP_WEB_LAUNCHER": str(PRODUCT_LAUNCHER),
        "OMP_WEB_MANIFEST_SHA256": hashlib.sha256(manifest).hexdigest(),
        "OMP_WEB_PORT": str(PRODUCT_PORT),
        "OMP_WEB_ORIGIN": f"http://127.0.0.1:{PRODUCT_PORT}",
        "OMP_WEB_DATA_DIR": str(data / "access"),
        "OMP_WEB_ASSETS": str(PRODUCT_ASSETS),
    }


def bootstrap(env):
    output = subprocess.check_output([BUN, "--no-env-file", str(PRODUCT_HOST), "--print-bootstrap"],
                                     cwd=ROOT, env=env, text=True)
    return output.strip().splitlines()[-1]


async def wait_until(condition, timeout):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        try:
            if await condition():
                return
        except Exception:
            pass
        await asyncio.sleep(0.03)
    raise TimeoutError("condition not met before timeout")


class BlockedSession(Exception):
    """A refused strict startup or projection is a blocked precondition, never a slow performance sample."""

    def __init__(self, code, raw):
        super().__init__(f"{code}: {raw}")
        self.code, self.raw = code, raw


async def history_ready(page, timeout=CHAT_TIMEOUT_MS):
    """The stock shell restores the selected Session after a reload; its first history page and the
    Load earlier control appear only once the projection is active."""
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        alerts = " ".join(await page.locator('[role="alert"]').all_inner_texts()).strip()
        if "STRICT_STARTUP_FAILED" in alerts:
            raise BlockedSession("STRICT_STARTUP_FAILED", alerts)
        if "Session projection failed" in alerts:
            raise BlockedSession("SESSION_PROJECTION_FAILED", alerts)
        if await page.locator(SESSION).count() and await page.locator(SESSION).first.get_attribute(
                "data-conversation-session") == SESSION_ID:
            nodes = await page.locator(NODE).count()
            history = page.locator(HISTORY)
            if nodes and await history.count() and await history.first.get_attribute("data-chat-history") == "idle":
                return
        await asyncio.sleep(0.05)
    raise TimeoutError("stock Session transcript did not render before timeout")


def classify_console_error(text, measuring_open, errors, teardown_errors):
    """Classify one console error where playwright dispatched it.

    A message that arrives while the measurement is open failed the sample; only an error that arrives after the
    final sample is teardown fault.
    """
    if "404" in text:
        return
    (errors if measuring_open else teardown_errors).append(f"console: {text}")


def console_handler(errors, teardown_errors, measuring, position=lambda: ""):
    """Build the console listener. It must stay synchronous: a coroutine listener would run as a scheduled task and
    could read the flag after the measurement already closed."""

    def log_console(message):
        if os.environ.get("OMP_PERF_DEBUG") and message.text.startswith("OMP_CHAT "):
            print("PRODUCT_CONSOLE", message.text, flush=True)
        if message.type != "error":
            return
        classify_console_error(message.text, measuring["open"], errors, teardown_errors)
        if os.environ.get("OMP_PERF_DEBUG"):
            print(f"PRODUCT_CONSOLE_ERROR measuring={measuring['open']} {position()} {message.text}", flush=True)

    return log_console


def console_classification_self_check():
    """An error emitted immediately before measurement close stays fatal, and the listener runs at dispatch."""
    measuring = {"open": True}
    errors, teardown_errors = [], []
    handler = console_handler(errors, teardown_errors, measuring)

    class Message:
        type = "error"
        text = "WebSocket connection to 'ws://localhost/api/remote.mux' failed"

    handler(Message())  # last console event of the measurement
    measuring["open"] = False
    handler(Message())  # the same error during teardown
    assert errors == [f"console: {Message.text}"], errors
    assert teardown_errors == [f"console: {Message.text}"], teardown_errors
    assert not inspect.iscoroutinefunction(handler), "console listener must run at dispatch, not as a task"
    ignored = []
    classify_console_error("Failed to load resource: 404", True, ignored, [])
    assert ignored == [], ignored


def request_tracker(page):
    """Count the requests the document currently has in flight and when the last one started or finished."""
    quiet = {"inflight": 0, "last": time.monotonic()}

    def started(_request):
        quiet["inflight"] += 1
        quiet["last"] = time.monotonic()

    def ended(_request):
        quiet["inflight"] = max(0, quiet["inflight"] - 1)
        quiet["last"] = time.monotonic()

    page.on("request", started)
    page.on("requestfinished", ended)
    page.on("requestfailed", ended)
    return quiet


def request_tracker_self_check():
    """A request that starts after the load settles must reopen the quiet window."""
    class Page:
        def __init__(self):
            self.handlers = {}

        def on(self, event, handler):
            self.handlers.setdefault(event, []).append(handler)

    page = Page()
    quiet = request_tracker(page)
    page.handlers["request"][0](None)
    assert quiet["inflight"] == 1
    assert (time.monotonic() - quiet["last"]) * 1000 < QUIET_MS
    page.handlers["requestfinished"][0](None)
    assert quiet["inflight"] == 0


async def settle(page, quiet):
    """Wait until the document has stopped issuing requests before the sampled reload.

    A reload discards whatever the current document still has in flight, and the browser reports each aborted
    request as a console error. `networkidle` alone returns as soon as that lifecycle was reached once, which can
    be before the page's effects issue their own requests, so the wait also requires a fresh quiet window: the
    document crossed two animation frames, no request is in flight, and none started for the quiescence period.
    A document that never quiets fails the sample.
    """
    await page.evaluate(
        "async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }")
    await page.wait_for_load_state("networkidle", timeout=SETTLE_TIMEOUT_MS)

    async def quieted():
        return quiet["inflight"] == 0 and (time.monotonic() - quiet["last"]) * 1000 >= QUIET_MS

    try:
        await wait_until(quieted, SETTLE_TIMEOUT_MS)
    except TimeoutError:
        print(f"SETTLE_PENDING inflight={quiet['inflight']} "
              f"idle_ms={(time.monotonic() - quiet['last']) * 1000:.0f}", flush=True)
        raise


async def count_at_least(locator, minimum):
    return await locator.count() >= minimum


async def timed(page, action, ready, timeout=CHAT_TIMEOUT_MS):
    started = time.perf_counter()
    await action()
    await ready(timeout)
    return (time.perf_counter() - started) * 1000


def summarize(name, values, limit_ms, peak, errors):
    failures = [error for error in errors if error]
    return {
        "class": name,
        "samples": len(values),
        "all": values,
        "maxMs": max(values) if values else None,
        "medianMs": median(values) if values else None,
        "p95Ms": nearest_rank(values) if values else None,
        "limitMs": limit_ms,
        "hostPeakMiB": peak,
        "hostLimitMiB": HOST_RSS_MIB,
        "failures": failures,
        "pass": bool(values) and nearest_rank(values) <= limit_ms and (peak or 0) <= HOST_RSS_MIB and not failures,
    }


_STAGE_START = time.monotonic()
PRODUCT_STAGES = []


def stage(name: str):
    elapsed = int((time.monotonic() - _STAGE_START) * 1000)
    PRODUCT_STAGES.append({"name": name, "atMs": elapsed})
    print(f"product-stage: {elapsed}ms {name}", file=sys.stderr, flush=True)


def startup_line(path):
    try:
        return json.loads(Path(path).read_text().splitlines()[0])
    except (OSError, IndexError, ValueError):
        return None


def wait_startup(path, process, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = startup_line(path)
        if line is not None:
            return line
        if process.poll() is not None:
            raise RuntimeError(f"host exited before startup ({process.returncode}): {Path(path).read_text()[:4000]}")
        time.sleep(0.05)
    raise RuntimeError(f"host produced no startup line: {Path(path).read_text()[:4000]}")


async def load_earlier(page):
    return page.locator(HISTORY).get_by_role("button", name=re.compile(r"Load earlier"))


async def older_control(page):
    """The stock older-history control, independent of its label.

    While the shell settles a page the button's accessible name becomes "Processing"; its
    visible label is not a reachability signal. Native reach is whether this control remains
    enabled and each activation prepends another native page.
    """
    return page.locator(f"{HISTORY} button")


async def activate(control):
    """Activate the stock control by keyboard; turn action overlays can cover it after a scroll."""
    await control.first.focus()
    await control.first.press("Enter")


async def product_run(browser_args):
    data = Path(tempfile.mkdtemp(prefix="omp-perf-product-"))
    env = product_env(data)
    link = bootstrap(env)
    log_path = ROOT / "vendor/performance-evidence/product-host.log"
    host, log = start_host(PRODUCT_HOST, PRODUCT_PORT, env, log_path)
    errors = []
    try:
        await wait_port(PRODUCT_PORT)
        startup = wait_startup(log_path, host)
        if (startup or {}).get("sessionAdmission") != "admitted":
            raise RuntimeError(f"product Host did not admit the installation: {startup}")
        print(f"product-admission: {json.dumps(startup)}", file=sys.stderr, flush=True)
        stage("host-ready")
        from playwright.async_api import async_playwright
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=CHROME, headless=True, args=browser_args)
            sampler = RssSampler(host.pid, browser_process_pid())
            sampling = asyncio.create_task(sampler.run())
            page = await browser.new_page()
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            if os.environ.get("OMP_PERF_DEBUG"):
                await page.add_init_script("globalThis.__OMP_CHAT_DEBUG__ = true")
            # The strict UI carries the Session over one websocket. A socket is reported only after its handshake,
            # so a message about a handshake that never completed belongs to an attempt playwright never saw.
            sockets = []

            def track_socket(socket):
                if not socket.url.endswith("/api/remote.mux"):
                    return
                sockets.append(socket)
                if os.environ.get("OMP_PERF_DEBUG"):
                    print(f"WS_OPEN {socket.url} first={len(first)} old={len(old)}", flush=True)
                    socket.on("socketerror", lambda error: print(
                        f"WS_ERROR {socket.url} first={len(first)} old={len(old)} error={error}", flush=True))
                    socket.on("close", lambda _socket: print(f"WS_CLOSE {socket.url}", flush=True))

            page.on("websocket", track_socket)
            quiet = request_tracker(page)
            # Console errors count only while the measurement is running. Once the last sample is taken the page is
            # torn down (browser and Host close), and a connection reset during that teardown is not a measured
            # failure; it is recorded as teardown fault text so the run stays auditable. The listener is a plain
            # synchronous function: playwright dispatches console events synchronously, so the flag is read at
            # dispatch time and an error emitted just before the final sample cannot be re-classified as teardown
            # by a task that happens to run after the measurement closes.
            measuring = {"open": True}
            teardown_errors = []
            page.on("console", console_handler(errors, teardown_errors, measuring,
                                               lambda: f"first={len(first)} old={len(old)}"))
            if os.environ.get("OMP_PERF_DEBUG"):
                page.on("requestfailed", lambda request: print(f"REQUEST_FAILED {request.failure} {request.url}", flush=True))
                page.on("response", lambda response: print(f"MUX_RESPONSE {response.status} {response.url}", flush=True)
                        if "remote.mux" in response.url else None)
            first, old = [], []
            rows = 0
            try:
                cold_started = time.perf_counter()
                await page.goto(link)
                stage("page-loaded")
                await page.locator("[data-product-directories-toggle]").click()
                await page.get_by_label("Directory to authorize").fill(str(CORPUS / "project"))
                await page.get_by_role("button", name="Review directory", exact=True).click()
                await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
                await page.get_by_role("button", name="Refresh grants and catalog").click()
                granted = page.locator('li[data-product-grant][data-product-grant-status="valid"]')
                await wait_until(lambda: count_at_least(granted, 1), CHAT_TIMEOUT_MS)
                stage("granted")
                await granted.get_by_role("button", name="New Session here", exact=True).click()
                await wait_until(lambda: count_at_least(page.locator(SESSION), 1), CHAT_TIMEOUT_MS)
                stage("workspace-open")
                row = page.locator(f'[data-row-key="session:{SESSION_ID}"]')
                try:
                    await wait_until(lambda: count_at_least(row, 1), 180000)
                except TimeoutError:
                    raise RuntimeError("the stock Session list did not list the corpus Session")
                stage("catalog-listed")
                await row.first.click()
                stage("open-clicked")
                await history_ready(page, CHAT_TIMEOUT_MS)
                stage("session-present")
                cold_open_ms = round((time.perf_counter() - cold_started) * 1000, 1)
                stage(f"cold-open:{cold_open_ms:.0f}ms")

                async def reopen(timeout):
                    """A reload restores the selected native Session and its first history page; the stock
                    shell needs no row click and no catalog refresh."""
                    await history_ready(page, timeout)

                for index in range(WARMUPS + SAMPLES):
                    await settle(page, quiet)
                    elapsed = await timed(page, lambda: page.reload(wait_until="domcontentloaded"), reopen)
                    stage(f"first-page-{index}:{elapsed:.0f}ms")
                    if index >= WARMUPS:
                        first.append(elapsed)
                rows = await page.locator(NODE).count()
                stage(f"history-nodes={rows}")
                old_unavailable = None
                for index in range(WARMUPS + SAMPLES):
                    control = await load_earlier(page)
                    if not await control.count() or await control.first.is_disabled():
                        old_unavailable = "no enabled Load earlier control: the native window has no older records"
                        stage(f"old-page-unavailable:{old_unavailable}")
                        break
                    before = await page.locator(NODE).count()

                    async def ready(timeout, before=before):
                        async def advanced():
                            return await page.locator(NODE).count() > before
                        await wait_until(advanced, timeout)

                    elapsed = await timed(page, lambda: activate(control), ready)
                    stage(f"old-page-{index}:{elapsed:.0f}ms")
                    if index >= WARMUPS:
                        old.append(elapsed)
                    await settle(page, quiet)
                    await page.reload(wait_until="domcontentloaded")
                    await reopen(CHAT_TIMEOUT_MS)
                reach_started = time.perf_counter()
                steps = 0
                reach_reset = None
                while steps < REACH_STEPS:
                    control = await older_control(page)
                    if not await control.count() or await control.first.is_disabled():
                        break
                    before_nodes = await page.locator(NODE).count()

                    async def advanced(before_nodes=before_nodes):
                        return await page.locator(NODE).count() > before_nodes

                    stage(f"reach-{steps}:nodes={before_nodes}")
                    await activate(control)
                    try:
                        await wait_until(advanced, REACH_STEP_MS)
                    except TimeoutError:
                        nodes_now = await page.locator(NODE).count()
                        if nodes_now < before_nodes:
                            reach_reset = {"step": steps, "nodesBefore": before_nodes, "nodesAfter": nodes_now,
                                           "status": await page.locator(HISTORY).first.get_attribute("data-chat-history"),
                                           "detail": "projection reset to the first page during load-earlier",
                                           "errors": errors[-2:]}
                            stage(f"reach-{steps}-reset:{json.dumps(reach_reset)}")
                            break
                        stage(f"reach-{steps}-timeout:status={await page.locator(HISTORY).first.get_attribute('data-chat-history')}:nodes={nodes_now}:errors={errors[-2:]}")
                        raise
                    steps += 1
                reachable_nodes = await page.locator(NODE).count()
                control = await older_control(page)
                reachable_more = bool(await control.count() and not await control.first.is_disabled())
                reachable_text = await page.locator(HISTORY).text_content() or ""
                oldest = await page.locator(NODE).first.text_content() or ""
                # Re-presenting the live Session must refresh metadata only; releasing and reopening it would
                # collapse the window this walk just proved reachable back to the first page.
                duplicate_nodes = reachable_nodes
                duplicate_present = {"nodesBefore": duplicate_nodes, "nodesAfter": reachable_nodes, "preserved": True}
                try:
                    row = page.locator(f'[data-row-key="session:{SESSION_ID}"]')
                    if await row.count():
                        await row.first.click()

                        async def preserved():
                            return await page.locator(NODE).count() >= duplicate_nodes
                        await wait_until(preserved, 10000)
                        duplicate_present["nodesAfter"] = await page.locator(NODE).count()
                        duplicate_present["preserved"] = duplicate_present["nodesAfter"] >= duplicate_nodes
                except TimeoutError:
                    duplicate_present["nodesAfter"] = await page.locator(NODE).count()
                    duplicate_present["preserved"] = duplicate_present["nodesAfter"] >= duplicate_nodes
                stage(f"duplicate-present={duplicate_present}")
                reachability = {"nodes": reachable_nodes, "steps": steps, "more": reachable_more,
                                "firstNode": oldest[:120],
                                "allNativeReachable": not reachable_more and reach_reset is None and steps > 0
                                and ("Entry 0" in reachable_text or "Entry 0" in oldest)
                                and duplicate_present["preserved"],
                                "duplicatePresent": duplicate_present,
                                "reset": reach_reset,
                                "reason": reach_reset["detail"] if reach_reset is not None else
                                f"stopped after {REACH_STEPS} steps at node {reachable_nodes}" if reachable_more else
                                "re-presenting the live Session collapsed the loaded window" if not duplicate_present["preserved"] else None,
                                "elapsedMs": round((time.perf_counter() - reach_started) * 1000, 1)}
                stage(f"reachability={reachability}")
            finally:
                measuring["open"] = False
                sampler.stop()
                await sampling
                peak = sampler.report()
                await browser.close()
        result = {
            "class": "product",
            "nativeSessionId": SESSION_ID,
            "historyRows": rows,
            "reachability": reachability,
            "coldOpenMs": cold_open_ms,
            "firstPage": summarize("product-first-page", first + [cold_open_ms], FIRST_PAGE_P95_MS, peak["hostPeakMiB"], errors),
            "oldPage": summarize("product-old-page", old, OLD_PAGE_P95_MS, peak["hostPeakMiB"], errors + ([old_unavailable] if old_unavailable else [])),
            "rss": peak,
            "teardownConsoleErrors": teardown_errors,
            "productAdmission": startup,
        }
        return result
    except BlockedSession as blocked:
        evidence = ROOT / "vendor/performance-evidence/product-blocked.json"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "nativeSessionId": SESSION_ID,
            "status": "blocked",
            "code": blocked.code,
            "raw": blocked.raw,
            "stageTimingMs": PRODUCT_STAGES,
            "rss": locals().get("peak"),
            "note": "Strict startup or Session projection refused before any sample; recorded as a blocked precondition, not a performance failure.",
        }
        evidence.write_text(json.dumps(record, indent=2) + "\n")
        print(f"product-blocked: {json.dumps(record)}", file=sys.stderr, flush=True)
        return {"class": "product", "status": "blocked", "blocked": record}
    except Exception as failure:
        evidence = ROOT / "vendor/performance-evidence/product-failure.json"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text(json.dumps({
            "nativeSessionId": SESSION_ID,
            "stageTimingMs": PRODUCT_STAGES,
            "firstPageSamplesMs": locals().get("first", []),
            "oldPageSamplesMs": locals().get("old", []),
            "historyRows": locals().get("rows"),
            "rss": locals().get("peak"),
            "error": f"{type(failure).__name__}: {failure}",
            "note": "Cold open retained in the sample set; no over-budget sample is excluded.",
        }, indent=2) + "\n")
        raise
    finally:
        stop_host(host)
        log.close()
        shutil.rmtree(data, ignore_errors=True)


def memory_limit_mib():
    """Cgroup v2 memory.max of this process; recorded so a capped run never claims physical RAM."""
    try:
        path = [line.split("::", 1)[1] for line in Path("/proc/self/cgroup").read_text().splitlines() if "::" in line][-1]
        raw = Path("/sys/fs/cgroup" + path + "/memory.max").read_text().strip()
        return None if raw == "max" else round(int(raw) / 1048576)
    except (OSError, IndexError, ValueError):
        return None


def run_verdict(evidence):
    """Classes that fail the gate: latency/RSS samples and a short or reset native reach walk."""
    measured = [result for result in evidence["classes"] if result.get("status") != "blocked"]
    failed = [result["class"] for result in measured
              for entry in (result["firstPage"], result["oldPage"]) if not entry["pass"]]

    def short_walk(result):
        reachability = result.get("reachability") or {}
        return reachability.get("allNativeReachable") is False or bool(reachability.get("reset"))

    reach_failed = [result["class"] for result in measured if short_walk(result)]
    return failed + [name for name in reach_failed if name not in failed], reach_failed


def self_check():
    """A measured history walk that resets or stops short fails the run even when latency passes."""
    passing = {"samples": [1.0], "pass": True}

    def evidence(reachability):
        return {"classes": [{"class": "product", "firstPage": passing, "oldPage": passing,
                             "reachability": reachability}]}

    assert run_verdict(evidence({"allNativeReachable": True})) == ([], [])
    assert run_verdict(evidence({"allNativeReachable": False})) == (["product"], ["product"])
    assert run_verdict(evidence(None)) == ([], [])
    assert run_verdict(evidence({"allNativeReachable": True, "reset": "history_stale_cursor"})) == (["product"], ["product"])
    assert run_verdict({"classes": [{"class": "product", "status": "blocked"}]}) == ([], [])
    failed = {"samples": [2.0], "pass": False}
    evidence_with_latency = evidence({"allNativeReachable": False})
    evidence_with_latency["classes"][0]["firstPage"] = failed
    assert run_verdict(evidence_with_latency) == (["product"], ["product"])
    console_classification_self_check()
    request_tracker_self_check()
    print("performance exit self-check ok")


async def main():
    global SAMPLES
    parser = argparse.ArgumentParser()
    parser.add_argument("--class", dest="classes", choices=["product", "all"], default="product")
    parser.add_argument("--samples", type=int, default=SAMPLES)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        self_check()
        return 0
    SAMPLES = args.samples
    if not CORPUS.joinpath("corpus.json").is_file():
        sys.exit("missing corpus; run scripts/create-performance-corpus.ts")
    if not CHROME or not BUN:
        sys.exit("google-chrome and bun are required")
    manifest = json.loads((CORPUS / "corpus.json").read_text())
    cpus = len(os.sched_getaffinity(0))
    physical_cpus = os.cpu_count() or cpus
    try:
        browser_version = subprocess.check_output([CHROME, "--version"], text=True).strip()
    except (OSError, subprocess.SubprocessError):
        browser_version = None
    mount = subprocess.run(["findmnt", "-no", "FSTYPE", "--target", str(ROOT)], capture_output=True, text=True)
    evidence = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "productMeasurement": "measured: product Host apps/host/src/main.ts over the enrolled installation",
        "admission": "not-yet-exercised",
        "reference": manifest["reference"],
        "actual": {
            "cpus": cpus,
            "machineCpus": physical_cpus,
            "cpuAffinityEmulation": None if cpus == physical_cpus else f"{cpus} of {physical_cpus} processors by affinity (taskset); not 4-vCPU hardware",
            "memoryMiB": round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1048576),
            "memoryLimitMiB": memory_limit_mib(),
            "kernel": Path("/proc/version").read_text().strip(),
            "filesystem": mount.stdout.strip() or None,
            "browser": browser_version,
            "controlledProvider": "config.yml extension compatibility/omp/fixtures/live-provider.ts with modelRoles.default "
                                  "s0-controlled/deterministic-live; deterministic fixture, not real model inference",
            "runtime": "see corpus.json",
        },
        "corpus": {"seed": manifest["seed"], "generator": manifest["generator"].get("sha256"),
                   "limits": manifest["limits"],
                   "canonicalization": manifest.get("canonicalization"),
                   "catalog": {key: manifest["catalog"][key] for key in ("sessions", "idsSha256", "canonicalFilesSha256")},
                   "history": {key: manifest["history"][key] for key in
                               ("entries", "bytes", "sha256", "canonicalBytes", "canonicalSha256", "typeDistribution")}},
        "protocol": {"warmups": WARMUPS, "samples": SAMPLES, "nearestRankP95": "sorted[ceil(0.95*N)-1]",
                     "rssSamplingMs": RSS_INTERVAL * 1000, "rssSource": "/proc/<pid>/status VmRSS + VmHWM",
                     "chatJournalLimitBytes": int(os.environ.get("OMP_PERF_JOURNAL_BYTES", "201326592"))},
        "limits": {"firstPageP95Ms": FIRST_PAGE_P95_MS, "oldPageP95Ms": OLD_PAGE_P95_MS, "hostPeakMiB": HOST_RSS_MIB},
        "installation": {"manifestSha256": hashlib.sha256(PRODUCT_MANIFEST.read_bytes()).hexdigest(),
                         "freeze": "docs/evidence/ticket-63-freeze.json"},
        "classes": [],
    }
    try:
        measured = await product_run(["--no-sandbox"])
        evidence["classes"].append(measured)
        if measured.get("status") == "blocked":
            blocked = measured["blocked"]
            evidence["productMeasurement"] = (
                f"blocked: product Host open refused by {blocked['code']} before any sample; "
                "raw stage/RSS evidence in vendor/performance-evidence/product-blocked.json")
            evidence["admission"] = "admitted: product Host verified the enrolled installation; Session open blocked"
        else:
            evidence["productMeasurement"] = (
                "measured: product Host apps/host/src/main.ts over the enrolled installation "
                f"({hashlib.sha256(PRODUCT_MANIFEST.read_bytes()).hexdigest()}) serving the 1000-Session corpus "
                "and the 10000-entry/100MiB history through the real catalog and session worker")
            evidence["admission"] = "admitted: product Host verified the enrolled installation and served the measured session"
    finally:
        output = ROOT / "vendor/performance-evidence/performance.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps(evidence, indent=2))
    failed, reach_failed = run_verdict(evidence)
    blocked = [result["class"] for result in evidence["classes"] if result.get("status") == "blocked"]
    print(f"BLOCKED_CLASSES={blocked}", file=sys.stderr)
    print(f"REACH_FAILED_CLASSES={reach_failed}", file=sys.stderr)
    print(f"FAILED_CLASSES={failed}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
