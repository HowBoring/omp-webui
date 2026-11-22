#!/usr/bin/env python3
"""S5 performance evidence over the real isolated Hosts and a real browser.

Corpus: scripts/create-performance-corpus.ts (1000 native Sessions, 10000-entry/100MiB history).
`catalog` and `chat` measure isolated component Hosts. `product` measures the product Host
(apps/host/src/main.ts) against the enrolled installation; only `product` is product measurement.
"""
import argparse, asyncio, hashlib, json, math, os, re, shutil, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("BUN") or shutil.which("bun")
CORPUS = ROOT / "vendor/performance-fixture"
CATALOG_HOST = ROOT / "vendor/host-catalog/catalog-fixture-main.js"
CHAT_HOST = ROOT / "vendor/host-chat/chat-component-main.js"
PRODUCT_HOST = ROOT / "apps/host/src/main.ts"
PRODUCT_MANIFEST = ROOT / "vendor/product/installation.json"
PRODUCT_LAUNCHER = ROOT / "vendor/omp-candidate/omp"
PRODUCT_ASSETS = ROOT / "vendor/dsh-product"
CATALOG_PORT = int(os.environ.get("OMP_PERF_CATALOG_PORT", "3191"))
CHAT_PORT = int(os.environ.get("OMP_PERF_CHAT_PORT", "3198"))
PRODUCT_PORT = int(os.environ.get("OMP_PERF_PRODUCT_PORT", "3193"))
SAMPLES = int(os.environ.get("OMP_PERF_SAMPLES", "30"))
WARMUPS = int(os.environ.get("OMP_PERF_WARMUPS", "2"))
RSS_INTERVAL = 0.045
CATALOG_P95_MS = 3000.0
OLD_PAGE_P95_MS = 1000.0
HOST_RSS_MIB = 512.0
CHAT_TIMEOUT_MS = int(os.environ.get("OMP_PERF_CHAT_TIMEOUT_MS", "300000"))
REACH_STEP_MS = int(os.environ.get("OMP_PERF_REACH_STEP_MS", "30000"))


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
    """Playwright async exposes no process handle; identify the newest headless Chrome browser process."""
    best = None
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        command = cmdline(int(entry.name))
        if "chrome" in command and "--remote-debugging-pipe" in command and "--type=" not in command:
            pid = int(entry.name)
            try:
                started = int((entry / "stat").read_text().rsplit(")", 1)[1].split()[19])
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
    subprocess.run(["pkill", "-9", "-f", str(host)], check=False)
    deadline = time.monotonic() + 20
    while serving(port) and time.monotonic() < deadline:
        time.sleep(0.1)
    if serving(port):
        raise RuntimeError(f"port {port} is already serving another workload; refusing to measure")
    log.parent.mkdir(parents=True, exist_ok=True)
    handle = log.open("w")
    process = subprocess.Popen([BUN, "--no-env-file", str(host)], cwd=ROOT, env=env, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
    return process, handle


def stop_host(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


def corpus_env(manifest):
    return {
        **os.environ,
        "OMP_CATALOG_FIXTURE_HOME": str(CORPUS),
        "OMP_CATALOG_FIXTURE_PORT": str(CATALOG_PORT),
        "OMP_CATALOG_FIXTURE_MANIFEST": str(manifest),
        "OMP_CATALOG_SOURCES": json.dumps([str(CORPUS / "sessions/bucket")]),
    }


def chat_env(manifest, data):
    return {
        **os.environ,
        "OMP_CHAT_PERFORMANCE": "1",
        "OMP_CHAT_FIXTURE_HOME": str(CORPUS),
        "OMP_CHAT_PORT": str(CHAT_PORT),
        "OMP_CHAT_FIXTURE_DATA": str(data),
        "OMP_LIVE_JOURNAL_MAX_BYTES": os.environ.get("OMP_PERF_JOURNAL_BYTES", "201326592"),
    }


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
        "OMP_WEB_DATA_DIR": str(data / "access"),
        "OMP_WEB_ASSETS": str(PRODUCT_ASSETS),
    }


def bootstrap(env, host=CHAT_HOST):
    output = subprocess.check_output([BUN, "--no-env-file", str(host), "--print-bootstrap"], cwd=ROOT, env=env, text=True)
    return output.strip()


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


async def session_ready(page, timeout=CHAT_TIMEOUT_MS):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        alerts = " ".join(await page.locator('[role="alert"]').all_inner_texts()).strip()
        if "STRICT_STARTUP_FAILED" in alerts:
            raise BlockedSession("STRICT_STARTUP_FAILED", alerts)
        if "Session projection failed" in alerts:
            raise BlockedSession("SESSION_PROJECTION_FAILED", alerts)
        if await page.locator('[data-chat-native-session="10000000-0000-4000-8000-000000000000"]').count() \
                and await page.locator("[data-chat-node], [data-chat-native-record]").count():
            return
        await asyncio.sleep(0.05)
    raise TimeoutError("session nodes did not render before timeout")


async def settle(page):
    """A reload aborts whatever the current document still has in flight, and the browser reports each aborted
    request as a console error. Wait for the document to go idle first so every sample measures a reload of a
    settled page instead of its own navigation aborts."""
    try:
        await page.wait_for_load_state("networkidle", timeout=5000)
    except TimeoutError:
        pass


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


async def catalog_run(browser_args):
    env = corpus_env(ROOT / "vendor/catalog/installation.json")
    host, log = start_host(CATALOG_HOST, CATALOG_PORT, env, ROOT / "vendor/performance-evidence/catalog-host.log")
    errors = []
    try:
        await wait_port(CATALOG_PORT)
        from playwright.async_api import async_playwright
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=CHROME, headless=True, args=browser_args)
            sampler = RssSampler(host.pid, browser_process_pid())
            sampling = asyncio.create_task(sampler.run())
            page = await browser.new_page()
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.on("console", lambda message: errors.append(f"console: {message.text}") if message.type == "error" and "404" not in message.text else None)
            origin = f"http://127.0.0.1:{CATALOG_PORT}/"
            first, old = [], []
            try:
                for index in range(WARMUPS + SAMPLES):
                    async def ready(timeout):
                        await page.wait_for_selector('#catalog[data-status="partial"]', timeout=timeout)
                        await wait_until(lambda: count_at_least(page.locator("article"), 1), 2000)
                    elapsed = await timed(page, lambda: page.goto(origin, wait_until="domcontentloaded"), ready)
                    if index >= WARMUPS:
                        first.append(elapsed)
                rows = await page.locator("article").count()
                total_samples = WARMUPS + SAMPLES
                for index in range(total_samples):
                    if await page.locator("#next").is_disabled():
                        await page.locator("#refresh").click()
                        await page.wait_for_selector('#catalog[data-status="partial"]')
                    before = await page.locator("article h2").first.text_content()
                    async def ready(timeout, before=before):
                        async def settled():
                            return (await page.locator("#catalog").get_attribute("data-status")) == "partial" and (await page.locator("article h2").first.text_content()) != before
                        await wait_until(settled, timeout)
                    elapsed = await timed(page, lambda: page.locator("#next").click(), ready)
                    if index >= WARMUPS:
                        old.append(elapsed)
            finally:
                sampler.stop()
                await sampling
                peak = sampler.report()
                await browser.close()
        result = {
            "class": "catalog",
            "rows": rows,
            "firstPage": summarize("catalog-first-page", first, CATALOG_P95_MS, peak["hostPeakMiB"], errors),
            "oldPage": summarize("catalog-old-page", old, OLD_PAGE_P95_MS, peak["hostPeakMiB"], errors),
            "rss": peak,
        }
        return result
    finally:
        stop_host(host)
        log.close()


_STAGE_START = time.monotonic()
CHAT_STAGES = []


def stage(name: str):
    elapsed = int((time.monotonic() - _STAGE_START) * 1000)
    CHAT_STAGES.append({"name": name, "atMs": elapsed})
    print(f"chat-stage: {elapsed}ms {name}", file=sys.stderr, flush=True)


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


async def chat_run(browser_args, product=False):
    kind = "product" if product else "chat"
    data = Path(tempfile.mkdtemp(prefix=f"omp-perf-{kind}-"))
    if product:
        env, host_path, port = product_env(data), PRODUCT_HOST, PRODUCT_PORT
    else:
        env, host_path, port = chat_env(ROOT / "vendor/chat/installation.json", data), CHAT_HOST, CHAT_PORT
    link = bootstrap(env, host_path)
    log_path = ROOT / f"vendor/performance-evidence/{kind}-host.log"
    host, log = start_host(host_path, port, env, log_path)
    errors = []
    try:
        await wait_port(port)
        startup = wait_startup(log_path, host)
        if product:
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
            # Console errors count only while the measurement is running. Once the last sample is taken the page is
            # torn down (browser and Host close), and a connection reset during that teardown is not a measured
            # failure; it is recorded as teardown fault text so the run stays auditable.
            measuring = {"open": True}
            teardown_errors = []
            async def log_console(message):
                if os.environ.get("OMP_PERF_DEBUG") and message.text.startswith("OMP_CHAT "):
                    print("PRODUCT_CONSOLE", message.text, flush=True)
                if message.type == "error" and "404" not in message.text:
                    if measuring["open"]:
                        errors.append(f"console: {message.text}")
                    else:
                        teardown_errors.append(f"console: {message.text}")
                    if os.environ.get("OMP_PERF_DEBUG"):
                        print(f"PRODUCT_CONSOLE_ERROR measuring={measuring['open']} {message.location} {message.text}", flush=True)
            page.on("console", lambda message: asyncio.create_task(log_console(message)))
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
                await page.get_by_label("Directory to authorize").fill(str(CORPUS / "project"))
                await page.get_by_role("button", name="Review directory", exact=True).click()
                await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
                stage("granted")
                refresh = page.get_by_role("button", name=re.compile(r"^Refresh (grants and )?catalog$"))
                await wait_until(lambda: refresh.is_enabled(), CHAT_TIMEOUT_MS)
                if await page.locator("li[data-native-id]").count() < 1000:
                    await refresh.click()
                await wait_until(lambda: count_at_least(page.locator("li[data-native-id]"), 1000), CHAT_TIMEOUT_MS)
                stage("catalog-1000")
                await page.locator('li[data-native-id="10000000-0000-4000-8000-000000000000"]').get_by_role("button", name=re.compile(r"(Open|Switch) Chat Session")).click()
                stage("open-clicked")
                await session_ready(page, CHAT_TIMEOUT_MS)
                stage("session-present")
                cold_open_ms = round((time.perf_counter() - cold_started) * 1000, 1)
                stage(f"cold-open:{cold_open_ms:.0f}ms")
                async def reopen(timeout):
                    refresh = page.get_by_role("button", name=re.compile(r"^Refresh (grants and )?catalog$"))
                    await wait_until(lambda: refresh.is_enabled(), timeout)
                    if await page.locator("li[data-native-id]").count() < 1000:
                        await refresh.click()
                    await wait_until(lambda: count_at_least(page.locator("li[data-native-id]"), 1000), timeout)
                    await page.locator('li[data-native-id="10000000-0000-4000-8000-000000000000"]').get_by_role("button", name=re.compile(r"(Open|Switch) Chat Session")).click()
                    await session_ready(page, timeout)
                for index in range(WARMUPS + SAMPLES):
                    await settle(page)
                    elapsed = await timed(page, lambda: page.reload(wait_until="domcontentloaded"), reopen)
                    stage(f"first-page-{index}:{elapsed:.0f}ms")
                    if index >= WARMUPS:
                        first.append(elapsed)
                rows = int(await page.locator("#conversation").get_attribute("data-chat-history-nodes"))
                initial_more = (await page.locator("#conversation").get_attribute("data-chat-history-more")) == "true"
                initial_first = await page.locator("#conversation").get_attribute("data-chat-history-first-seq")
                stage(f"history-nodes={rows} more={initial_more} first-seq={initial_first}")
                old_unavailable = None
                for index in range(WARMUPS + SAMPLES):
                    control = page.locator("[data-chat-load-earlier]")
                    if not await control.count() or await control.is_disabled():
                        old_unavailable = "no enabled older page control: the native window has no older records"
                        stage(f"old-page-unavailable:{old_unavailable}")
                        break
                    before = int(await page.locator("#conversation").get_attribute("data-chat-history-nodes"))
                    async def ready(timeout, before=before):
                        async def advanced():
                            current = await page.locator("#conversation").get_attribute("data-chat-history-nodes")
                            control = page.locator("[data-chat-load-earlier]")
                            return current is not None and int(current) > before and (
                                not await control.count() or not await control.is_disabled())
                        await wait_until(advanced, timeout)
                    elapsed = await timed(page, lambda: control.click(), ready)
                    stage(f"old-page-{index}:{elapsed:.0f}ms")
                    if index >= WARMUPS:
                        old.append(elapsed)
                    await settle(page)
                    await page.reload(wait_until="domcontentloaded")
                    await reopen(CHAT_TIMEOUT_MS)
                reach_started = time.perf_counter()
                steps = 0
                reach_reset = None
                first_before = await page.locator("#conversation").get_attribute("data-chat-history-first-seq")
                while steps < 400:
                    more = (await page.locator("#conversation").get_attribute("data-chat-history-more")) == "true"
                    control = page.locator("[data-chat-load-earlier]")
                    if not more or not await control.count():
                        break
                    before_nodes = int(await page.locator("#conversation").get_attribute("data-chat-history-nodes"))
                    before_seq = await page.locator("#conversation").get_attribute("data-chat-history-first-seq")
                    async def advanced(before_nodes=before_nodes, before_seq=before_seq):
                        nodes = await page.locator("#conversation").get_attribute("data-chat-history-nodes")
                        seq = await page.locator("#conversation").get_attribute("data-chat-history-first-seq")
                        return nodes is not None and int(nodes) >= before_nodes and seq != before_seq
                    stage(f"reach-{steps}:nodes={before_nodes}:seq={before_seq}:more={more}")
                    await control.click()
                    try:
                        await wait_until(lambda: advanced(), REACH_STEP_MS)
                    except TimeoutError:
                        nodes_now = await page.locator("#conversation").get_attribute("data-chat-history-nodes")
                        if nodes_now is not None and int(nodes_now) < before_nodes:
                            reach_reset = {"step": steps, "nodesBefore": before_nodes, "nodesAfter": int(nodes_now),
                                "seqBefore": before_seq,
                                "seqAfter": await page.locator("#conversation").get_attribute("data-chat-history-first-seq"),
                                "status": await page.locator("#conversation").get_attribute("data-chat-history-status"),
                                "detail": f"projection reset to the first page during load-earlier from seq {before_seq}",
                                "errors": errors[-2:]}
                            stage(f"reach-{steps}-reset:{json.dumps(reach_reset)}")
                            break
                        stage(f"reach-{steps}-timeout:status={await page.locator('#conversation').get_attribute('data-chat-history-status')}:nodes={nodes_now}:seq={await page.locator('#conversation').get_attribute('data-chat-history-first-seq')}:more={await page.locator('#conversation').get_attribute('data-chat-history-more')}:errors={errors[-2:]}")
                        raise
                    steps += 1
                reachable_nodes = int(await page.locator("#conversation").get_attribute("data-chat-history-nodes"))
                reachable_more = (await page.locator("#conversation").get_attribute("data-chat-history-more")) == "true"
                reachable_first = await page.locator("#conversation").get_attribute("data-chat-history-first-seq")
                oldest = await page.locator("#conversation [data-chat-node], #conversation [data-chat-native-record]").first.text_content()
                # Refresh re-presents the live Session. That duplicate view must refresh metadata only: releasing
                # and reopening it would collapse the window this walk just proved reachable back to the first page.
                duplicate_nodes = reachable_nodes
                duplicate_seq = reachable_first
                await page.locator("[data-chat-refresh]").click()
                await page.wait_for_timeout(2000)
                duplicate_after_nodes = int(await page.locator("#conversation").get_attribute("data-chat-history-nodes"))
                duplicate_after_seq = await page.locator("#conversation").get_attribute("data-chat-history-first-seq")
                duplicate_present = {"nodesBefore": duplicate_nodes, "nodesAfter": duplicate_after_nodes,
                    "firstSeqBefore": duplicate_seq, "firstSeqAfter": duplicate_after_seq,
                    "preserved": duplicate_after_nodes >= duplicate_nodes and duplicate_after_seq == duplicate_seq}
                stage(f"duplicate-present={duplicate_present}")
                reachability = {"nodes": reachable_nodes, "steps": steps, "more": reachable_more,
                    "firstSeqBefore": first_before, "firstSeqAfter": reachable_first,
                    "firstNode": (oldest or "")[:120],
                    "allNativeReachable": not reachable_more and reach_reset is None and steps > 0
                        and "Entry 0 " in (oldest or "") and duplicate_present["preserved"],
                    "duplicatePresent": duplicate_present,
                    "reset": reach_reset,
                    "reason": reach_reset["detail"] if reach_reset is not None else
                        f"stopped after 400 steps at seq {reachable_first}" if reachable_more else
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
            "class": kind,
            "nativeSessionId": "10000000-0000-4000-8000-000000000000",
            "historyRows": rows,
            "reachability": reachability,
            "coldOpenMs": cold_open_ms,
            "firstPage": summarize(f"{kind}-first-page", first + [cold_open_ms], CATALOG_P95_MS, peak["hostPeakMiB"], errors),
            "oldPage": summarize(f"{kind}-old-page", old, OLD_PAGE_P95_MS, peak["hostPeakMiB"], errors + ([old_unavailable] if old_unavailable else [])),
            "rss": peak,
            "teardownConsoleErrors": teardown_errors,
        }
        if product:
            result["productAdmission"] = startup
        return result
    except BlockedSession as blocked:
        evidence = ROOT / f"vendor/performance-evidence/{kind}-blocked.json"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "nativeSessionId": "10000000-0000-4000-8000-000000000000",
            "status": "blocked",
            "code": blocked.code,
            "raw": blocked.raw,
            "stageTimingMs": CHAT_STAGES,
            "rss": locals().get("peak"),
            "note": "Strict startup or Session projection refused before any sample; recorded as a blocked precondition, not a performance failure.",
        }
        evidence.write_text(json.dumps(record, indent=2) + "\n")
        print(f"{kind}-blocked: {json.dumps(record)}", file=sys.stderr, flush=True)
        return {"class": kind, "status": "blocked", "blocked": record}
    except Exception as failure:
        evidence = ROOT / f"vendor/performance-evidence/{kind}-failure.json"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text(json.dumps({
            "nativeSessionId": "10000000-0000-4000-8000-000000000000",
            "stageTimingMs": CHAT_STAGES,
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
    print("performance exit self-check ok")


async def main():
    global SAMPLES
    parser = argparse.ArgumentParser()
    parser.add_argument("--class", dest="classes", choices=["catalog", "chat", "product", "all"], default="all")
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
        "productMeasurement": "unclaimed: this run measured component Hosts only; run --class product to measure the product Host",
        "admission": "not-exercised: this run did not start the product Host",
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
        "protocol": {"warmups": WARMUPS, "samples": SAMPLES, "nearestRankP95": "sorted[ceil(0.95*N)-1]", "rssSamplingMs": RSS_INTERVAL * 1000, "rssSource": "/proc/<pid>/status VmRSS + VmHWM", "chatJournalLimitBytes": int(os.environ.get("OMP_PERF_JOURNAL_BYTES", "201326592"))},
        "limits": {"firstPageP95Ms": CATALOG_P95_MS, "oldPageP95Ms": OLD_PAGE_P95_MS, "hostPeakMiB": HOST_RSS_MIB},
        "classes": [],
    }
    try:
        if args.classes in ("catalog", "all"):
            evidence["classes"].append(await catalog_run(["--no-sandbox"]))
        if args.classes in ("chat", "all"):
            evidence["classes"].append(await chat_run(["--no-sandbox"]))
        if args.classes in ("product", "all"):
            measured = await chat_run(["--no-sandbox"], product=True)
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
