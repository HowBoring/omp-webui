#!/usr/bin/env python3
"""S5 performance evidence over the real isolated component Hosts and a real browser.

Corpus: scripts/create-performance-corpus.ts (1000 native Sessions, 10000-entry/100MiB history).
No fixture is measured as product: product admission remains blocked and this records component evidence.
"""
import argparse, asyncio, json, math, os, re, shutil, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path
from statistics import median
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("BUN") or shutil.which("bun")
CORPUS = ROOT / "vendor/performance-fixture"
CATALOG_HOST = ROOT / "vendor/host-catalog/catalog-fixture-main.js"
CHAT_HOST = ROOT / "vendor/host-chat/chat-component-main.js"
CATALOG_PORT = int(os.environ.get("OMP_PERF_CATALOG_PORT", "3191"))
CHAT_PORT = int(os.environ.get("OMP_PERF_CHAT_PORT", "3198"))
SAMPLES = int(os.environ.get("OMP_PERF_SAMPLES", "30"))
WARMUPS = int(os.environ.get("OMP_PERF_WARMUPS", "2"))
RSS_INTERVAL = 0.045
CATALOG_P95_MS = 3000.0
OLD_PAGE_P95_MS = 1000.0
HOST_RSS_MIB = 512.0
CHAT_TIMEOUT_MS = int(os.environ.get("OMP_PERF_CHAT_TIMEOUT_MS", "300000"))


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


def start_host(host, port, env, log):
    subprocess.run(["pkill", "-9", "-f", str(host)], check=False)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                time.sleep(0.1)
        except OSError:
            break
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
    }


def bootstrap(env):
    output = subprocess.check_output([BUN, "--no-env-file", str(CHAT_HOST), "--print-bootstrap"], cwd=ROOT, env=env, text=True)
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


async def chat_run(browser_args):
    data = Path(tempfile.mkdtemp(prefix="omp-perf-chat-"))
    env = chat_env(ROOT / "vendor/chat/installation.json", data)
    link = bootstrap(env)
    host, log = start_host(CHAT_HOST, CHAT_PORT, env, ROOT / "vendor/performance-evidence/chat-host.log")
    errors = []
    try:
        await wait_port(CHAT_PORT)
        stage("host-ready")
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=CHROME, headless=True, args=browser_args)
            sampler = RssSampler(host.pid, browser_process_pid())
            sampling = asyncio.create_task(sampler.run())
            page = await browser.new_page()
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.on("console", lambda message: errors.append(f"console: {message.text}") if message.type == "error" and "404" not in message.text else None)
            first, old = [], []
            rows = 0
            debug_task = None
            if os.environ.get("OMP_PERF_DEBUG") == "1":
                async def log_response(response):
                    if "/api/" not in response.url:
                        return
                    try:
                        body = await response.text()
                    except Exception as error:
                        body = f"<unreadable: {error}>"
                    if "catalog" in response.url:
                        body = body[:1200]
                    print(f"chat-response: {response.status} {response.url} {body}", file=sys.stderr, flush=True)
                page.on("response", lambda response: asyncio.create_task(log_response(response)))
                async def report_stalls():
                    for tick in range(12):
                        await asyncio.sleep(15)
                        try:
                            alert = await page.locator('[role="alert"]').first.inner_text()
                        except Exception:
                            alert = ""
                        print(f"chat-stall: t={(tick+1)*15}s rows={await page.locator('li[data-native-id]').count()} alert={alert!r}", file=sys.stderr, flush=True)
                debug_task = asyncio.create_task(report_stalls())
            try:
                cold_started = time.perf_counter()
                await page.goto(link)
                stage("page-loaded")
                await page.get_by_label("Directory to authorize").fill(str(CORPUS / "project"))
                await page.get_by_role("button", name="Review directory", exact=True).click()
                await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
                stage("granted")
                refresh = page.get_by_role("button", name="Refresh catalog", exact=True)
                await wait_until(lambda: refresh.is_enabled(), CHAT_TIMEOUT_MS)
                if await page.locator("li[data-native-id]").count() < 1000:
                    await refresh.click()
                await wait_until(lambda: count_at_least(page.locator("li[data-native-id]"), 1000), CHAT_TIMEOUT_MS)
                stage("catalog-1000")
                await page.locator('li[data-native-id="10000000-0000-4000-8000-000000000000"]').get_by_role("button", name=re.compile(r"(Open|Switch) Chat Session")).click()
                stage("open-clicked")
                await page.wait_for_selector('[data-chat-native-session="10000000-0000-4000-8000-000000000000"]', timeout=CHAT_TIMEOUT_MS)
                stage("session-present")
                await page.wait_for_selector("[data-chat-node]", timeout=CHAT_TIMEOUT_MS)
                stage("first-node")
                cold_open_ms = round((time.perf_counter() - cold_started) * 1000, 1)
                stage(f"cold-open:{cold_open_ms:.0f}ms")
                async def reopen(timeout):
                    refresh = page.get_by_role("button", name="Refresh catalog", exact=True)
                    await wait_until(lambda: refresh.is_enabled(), timeout)
                    if await page.locator("li[data-native-id]").count() < 1000:
                        await refresh.click()
                    await wait_until(lambda: count_at_least(page.locator("li[data-native-id]"), 1000), timeout)
                    await page.locator('li[data-native-id="10000000-0000-4000-8000-000000000000"]').get_by_role("button", name=re.compile(r"(Open|Switch) Chat Session")).click()
                    await page.wait_for_selector('[data-chat-native-session="10000000-0000-4000-8000-000000000000"]', timeout=timeout)
                    await page.wait_for_selector("[data-chat-node]", timeout=timeout)
                for index in range(WARMUPS + SAMPLES):
                    elapsed = await timed(page, lambda: page.reload(wait_until="domcontentloaded"), reopen)
                    stage(f"first-page-{index}:{elapsed:.0f}ms")
                    if index >= WARMUPS:
                        first.append(elapsed)
                window = await page.locator("#conversation").get_attribute("data-chat-history-window")
                rows = int(window.split("/")[1])
                stage(f"history-rows={rows}")
                old_unavailable = None
                for index in range(WARMUPS + SAMPLES):
                    if not await page.locator("[data-chat-load-earlier]").count():
                        old_unavailable = "no older page control: the live component window has no resident older records"
                        stage(f"old-page-unavailable:{old_unavailable}")
                        break
                    before = int((await page.locator("#conversation").get_attribute("data-chat-history-window")).split("/")[0])
                    async def ready(timeout, before=before):
                        async def windowed():
                            value = await page.locator("#conversation").get_attribute("data-chat-history-window")
                            return value is not None and int(value.split("/")[0]) == before + 50
                        await wait_until(windowed, timeout)
                    elapsed = await timed(page, lambda: page.locator("[data-chat-load-earlier]").click(), ready)
                    stage(f"old-page-{index}:{elapsed:.0f}ms")
                    if index >= WARMUPS:
                        old.append(elapsed)
                    await page.reload(wait_until="domcontentloaded")
                    await reopen(CHAT_TIMEOUT_MS)
                reach_started = time.perf_counter()
                steps = 0
                while steps < 300:
                    value = await page.locator("#conversation").get_attribute("data-chat-history-window")
                    shown_now, total = (int(part) for part in value.split("/"))
                    if shown_now >= total or not await page.locator("[data-chat-load-earlier]").count():
                        break
                    await page.locator("[data-chat-load-earlier]").click()
                    async def advanced(before=shown_now):
                        current = await page.locator("#conversation").get_attribute("data-chat-history-window")
                        return current is not None and int(current.split("/")[0]) == before + 50
                    await wait_until(advanced, CHAT_TIMEOUT_MS)
                    steps += 1
                reachable_window = await page.locator("#conversation").get_attribute("data-chat-history-window")
                reachable_nodes = await page.locator("[data-chat-node]").count()
                reachability = {"window": reachable_window, "nodes": reachable_nodes, "steps": steps,
                    "allRecordsRendered": reachable_window == f"{rows}/{rows}" and reachable_nodes == rows,
                    "elapsedMs": round((time.perf_counter() - reach_started) * 1000, 1)}
            finally:
                if debug_task is not None:
                    debug_task.cancel()
                sampler.stop()
                await sampling
                peak = sampler.report()
                await browser.close()
        return {
            "class": "chat",
            "nativeSessionId": "10000000-0000-4000-8000-000000000000",
            "historyRows": rows,
            "reachability": reachability,
            "coldOpenMs": cold_open_ms,
            "firstPage": summarize("chat-first-page", first + [cold_open_ms], CATALOG_P95_MS, peak["hostPeakMiB"], errors),
            "oldPage": summarize("chat-old-page", old, OLD_PAGE_P95_MS, peak["hostPeakMiB"], errors + ([old_unavailable] if old_unavailable else [])),
            "rss": peak,
        }
    except Exception as failure:
        evidence = ROOT / "vendor/performance-evidence/chat-failure.json"
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


async def main():
    global SAMPLES
    parser = argparse.ArgumentParser()
    parser.add_argument("--class", dest="classes", choices=["catalog", "chat", "all"], default="all")
    parser.add_argument("--samples", type=int, default=SAMPLES)
    args = parser.parse_args()
    SAMPLES = args.samples
    if not CORPUS.joinpath("corpus.json").is_file():
        sys.exit("missing corpus; run scripts/create-performance-corpus.ts")
    if not CHROME or not BUN:
        sys.exit("google-chrome and bun are required")
    manifest = json.loads((CORPUS / "corpus.json").read_text())
    cpus = len(os.sched_getaffinity(0))
    evidence = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "productMeasurement": "unclaimed: product Host cutover (#59) is not available; component Host evidence only",
        "admission": "blocked",
        "reference": manifest["reference"],
        "actual": {"cpus": cpus, "memoryMiB": round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1048576), "runtime": "see corpus.json"},
        "corpus": {"seed": manifest["seed"], "limits": manifest["limits"], "catalog": {key: manifest["catalog"][key] for key in ("sessions", "idsSha256")}, "history": {key: manifest["history"][key] for key in ("entries", "bytes", "sha256", "typeDistribution")}},
        "protocol": {"warmups": WARMUPS, "samples": SAMPLES, "nearestRankP95": "sorted[ceil(0.95*N)-1]", "rssSamplingMs": RSS_INTERVAL * 1000, "rssSource": "/proc/<pid>/status VmRSS + VmHWM"},
        "limits": {"firstPageP95Ms": CATALOG_P95_MS, "oldPageP95Ms": OLD_PAGE_P95_MS, "hostPeakMiB": HOST_RSS_MIB},
        "classes": [],
    }
    try:
        if args.classes in ("catalog", "all"):
            evidence["classes"].append(await catalog_run(["--no-sandbox"]))
        if args.classes in ("chat", "all"):
            evidence["classes"].append(await chat_run(["--no-sandbox"]))
    finally:
        output = ROOT / "vendor/performance-evidence/performance.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps(evidence, indent=2))
    failed = [entry["class"] for result in evidence["classes"] for entry in (result["firstPage"], result["oldPage"]) if not entry["pass"]]
    print(f"FAILED_CLASSES={failed}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
