#!/usr/bin/env python3
"""Real Linux Chromium + Host processes. Synthetic profiles only; never print secrets or URLs."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BUN = shutil.which("bun") or "/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Host:
    def __init__(self, data, port, tls=None):
        self.env = {**os.environ, "OMP_WEB_DATA_DIR": str(data), "OMP_WEB_PORT": str(port)}
        self.origin = f"{'https' if tls else 'http'}://127.0.0.1:{port}"
        if tls:
            self.env.update(OMP_WEB_TLS_CERT=str(tls[0]), OMP_WEB_TLS_KEY=str(tls[1]))
        self.process = None
        self.logs = ""

    def bootstrap(self):
        result = subprocess.run([BUN, "apps/host/src/main.ts", "--print-bootstrap"], cwd=ROOT,
                                env=self.env, capture_output=True, check=True, text=True)
        assert not result.stderr, "bootstrap command emitted unexpected diagnostics"
        return result.stdout.strip()

    def start(self):
        self.process = subprocess.Popen([BUN, "apps/host/src/main.ts"], cwd=ROOT, env=self.env,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.monotonic() + 10
        port = int(self.env["OMP_WEB_PORT"])
        while time.monotonic() < deadline:
            assert self.process.poll() is None, "Host exited before readiness"
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    return
            except OSError:
                time.sleep(0.05)
        raise AssertionError("Host did not listen")

    def stop(self, crash=False):
        if self.process:
            self.process.kill() if crash else self.process.terminate()
            output, _ = self.process.communicate(timeout=10)
            self.logs += output
            self.process = None


def run():
    results = []
    hosts = []
    with tempfile.TemporaryDirectory(prefix="omp-access-browser-") as scratch, sync_playwright() as pw:
        base = Path(scratch)
        browser = pw.chromium.launch(executable_path="/usr/bin/chromium", headless=True,
                                     args=["--no-sandbox"])
        try:
            host = Host(base / "data", free_port()); hosts.append(host)
            link = host.bootstrap(); host.start()
            first = browser.new_context(); second = browser.new_context()
            page = first.new_page()
            response = page.goto(link)
            assert page.url == host.origin + "/", "bootstrap URL was not cleaned"
            page.get_by_text("Browser authorized.", exact=False).wait_for()
            cookie = first.cookies()[0]
            assert cookie["httpOnly"] and cookie["sameSite"] == "Strict" and not cookie["secure"]
            assert abs(cookie["expires"] - time.time() - 30 * 86400) < 10
            assert (base / "data").stat().st_mode & 0o777 == 0o700
            assert (base / "data/browser-access.sqlite").stat().st_mode & 0o777 == 0o600
            assert first.request.get(link, max_redirects=0).status == 401
            assert first.request.get(host.origin + "/api/session/list").status == 503
            assert second.request.get(host.origin + "/api/session/list").status == 401
            assert not page.evaluate("document.cookie"), "HttpOnly cookie exposed to script"
            status = first.request.get(host.origin + "/auth/status")
            original_status = status.json()
            assert "set-cookie" not in status.headers
            results.append("PASS root exchange, clean URL, cookie flags/absolute expiry, private modes, API fail-closed")

            tab = first.new_page(); tab.goto(host.origin)
            tab.get_by_text("Browser authorized.", exact=False).wait_for()
            other = second.new_page(); other.goto(host.bootstrap())
            other.get_by_text("Browser authorized.", exact=False).wait_for()
            host.stop(crash=True); host.start()
            page.reload(); tab.reload(); other.reload()
            for current in [page, tab, other]:
                current.get_by_text("Browser authorized.", exact=False).wait_for()
            current_status = first.request.get(host.origin + "/auth/status").json()
            assert current_status["expiresAt"] == original_status["expiresAt"]
            assert current_status["hostId"] == original_status["hostId"]
            results.append("PASS actual SIGKILL Host restart, refresh, multiple pages, stable identity, no sliding renewal")

            assert first.request.post(host.origin + "/auth/logout", headers={"Origin": host.origin}).status == 403
            assert first.request.post(host.origin + "/auth/logout", headers={
                "Origin": "null", "x-omp-csrf": current_status["csrf"]}).status == 403
            page.get_by_role("button", name="Log out").click()
            page.get_by_text("Browser authorization required.", exact=False).wait_for()
            tab.get_by_text("Browser authorization required.", exact=False).wait_for()
            other.reload(); other.get_by_text("Browser authorized.", exact=False).wait_for()
            host.stop(crash=True); host.start()
            replay = second.request.get(host.origin + "/auth/status", headers={
                "Cookie": f"{cookie['name']}={cookie['value']}"})
            assert replay.status == 401
            assert second.request.get(host.origin + "/auth/status").status == 200
            results.append("PASS real browser logout, shared-cookie tabs, second credential isolation, durable crash-restart revocation")

            # Persistent disk browser profile uses only this deliberately synthetic Host account.
            persistent = pw.chromium.launch_persistent_context(base / "profile", executable_path="/usr/bin/chromium",
                         headless=True, args=["--no-sandbox"])
            persistent.pages[0].goto(host.bootstrap())
            persistent.pages[0].get_by_text("Browser authorized.", exact=False).wait_for()
            persistent.close(); host.stop(); host.start()
            persistent = pw.chromium.launch_persistent_context(base / "profile", executable_path="/usr/bin/chromium",
                         headless=True, args=["--no-sandbox"])
            persistent.pages[0].goto(host.origin)
            persistent.pages[0].get_by_text("Browser authorized.", exact=False).wait_for()
            persistent.close()
            results.append("PASS actual browser process/profile restart and graceful Host restart")

            changed_dir = Host(base / "different-data", int(host.env["OMP_WEB_PORT"])); hosts.append(changed_dir)
            host.stop(); changed_dir.start()
            assert second.request.get(host.origin + "/auth/status").status == 401
            changed_dir.stop()
            changed_origin = Host(base / "data", free_port()); hosts.append(changed_origin)
            changed_origin.start()
            assert second.request.get(changed_origin.origin + "/auth/status").status == 401
            changed_origin.stop()
            results.append("PASS same-browser cookie rejected after data directory and origin changes")

            key, cert = base / "key.pem", base / "cert.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                            "-subj", "/CN=127.0.0.1", "-keyout", str(key), "-out", str(cert)],
                           check=True, capture_output=True)
            tls = Host(base / "tls-data", free_port(), (cert, key)); hosts.append(tls)
            tls.start()
            secure = browser.new_context(ignore_https_errors=True)
            secure_page = secure.new_page(); secure_page.goto(tls.bootstrap())
            secure_page.get_by_text("Browser authorized.", exact=False).wait_for()
            assert secure.cookies()[0]["secure"]
            assert secure.cookies()[0]["httpOnly"] and secure.cookies()[0]["sameSite"] == "Strict"
            results.append("PASS actual Bun TLS listener emits Secure cookie (HTTP listener does not)")
            secure.close(); first.close(); second.close()
            for item in hosts:
                item.stop()
                assert "bootstrap=" not in item.logs and cookie["value"] not in item.logs
            results.append("PASS routine Host logs contain no bootstrap URL or browser credential")
            print(json.dumps({"scope": "Linux Chromium access component; private Session/native/DSH gate stays closed",
                              "browser": browser.version, "bun": subprocess.check_output([BUN, "--version"], text=True).strip(),
                              "results": results, "windows_wsl2": "DEFERRED by user"}, indent=2))
        finally:
            for item in hosts:
                item.stop()
            browser.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        # Playwright exceptions can contain bootstrap URLs, so never print raw exceptions/traces.
        print(json.dumps({"status": "FAIL", "error_type": type(error).__name__, "detail": "Access browser scenario failed"}))
        raise SystemExit(1)
