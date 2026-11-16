"""Actual Host acceptance and explicitly intercepted carrier faults; no native fixture success."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from playwright.async_api import async_playwright


async def run(args):
    results = {"url": args.url, "kind": "actual-host-plus-labelled-carrier-faults", "cases": []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/chromium", headless=True,
                                          args=["--no-sandbox"])
        results["browser"] = browser.version
        page = await browser.new_page()
        responses = []
        mux_frames = []
        page.on("response", lambda response: responses.append(response))
        page.on("websocket", lambda socket: socket.on("framesent", lambda frame: mux_frames.append(frame)))
        await page.goto(args.url)
        await page.locator('#diagnostic[data-status="verified-blocked"]').wait_for()
        body = await page.locator("#diagnostic").inner_text()
        assert "Session admission: blocked" in body
        assert args.expected_code in body, body
        assert "installationSha256" in body
        actual = [r for r in responses if r.url.endswith("/api/ompDiagnostics/preflight")]
        assert actual
        envelope = await actual[-1].json()
        assert envelope["result"]["ok"] is True
        assert envelope["result"]["value"]["status"] == "verified-blocked"
        openings = [json.loads(frame) for frame in mux_frames if isinstance(frame, str)
                    and json.loads(frame).get("type") == "open"]
        assert openings and all(frame["endpoint"] == "$events" for frame in openings)
        assert all("/api/ompDiagnostics/preflight" in r.url for r in responses if "/api/" in r.url)
        assert len(await page.locator("input,textarea,select,button").all()) == 0
        results["cases"].append({"name": "actual-native-preflight", "result": "PASS",
                                 "report": envelope["result"]["value"]})
        output = Path(args.evidence)
        output.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(output / "diagnostic.png"), full_page=True)
        # Explicitly simulated persisted lifecycle events at the public browser
        # boundary; this is not a claim of real Chromium BFCache retention.
        await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}))")
        await page.get_by_text("diagnostic_page_suspended", exact=True).wait_for()
        assert "installationSha256" not in await page.locator("#diagnostic").inner_text()
        previous_calls = len([r for r in responses if r.url.endswith("/api/ompDiagnostics/preflight")])
        await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))")
        await page.locator('#diagnostic[data-status="verified-blocked"]').wait_for()
        assert len([r for r in responses if r.url.endswith("/api/ompDiagnostics/preflight")]) > previous_calls
        results["cases"].append({"name": "simulated-persisted-page-restore-fresh-preflight", "result": "PASS"})
        await page.close()

        for fault in ["wrong-rpc-id", "malformed-report", "unsupported-remote", "failed-asset"]:
            page = await browser.new_page()

            async def intercept(route, fault=fault):
                if fault == "failed-asset":
                    await route.abort()
                    return
                call = route.request.post_data_json
                if fault == "unsupported-remote":
                    result = {"ok": False, "error": {"code": "gateway/not-found",
                              "message": "/private/raw-stderr-secret", "details": {"stderr": "secret"}}}
                else:
                    value = {"status": "verified-blocked", "sessionAdmission": "blocked",
                             "code": "untrusted", "missingCapabilities": [], "stderr": "/private/raw-stderr-secret"}
                    result = {"ok": True, "value": value}
                await route.fulfill(json={"type": "server-response",
                                          "rpcId": "wrong-id" if fault == "wrong-rpc-id" else call["rpcId"],
                                          "result": result})

            await page.route("**/client.js" if fault == "failed-asset" else "**/api/ompDiagnostics/preflight", intercept)
            await page.goto(args.url)
            expected = "diagnostic_assets_unavailable" if fault == "failed-asset" else "remote_preflight_failed"
            await page.get_by_text(expected, exact=True).wait_for()
            body = await page.locator("#diagnostic").inner_text()
            assert "Session admission: blocked" in body
            assert "secret" not in body and "/private" not in body
            assert await page.locator("#diagnostic").get_attribute("data-status") == "blocked"
            results["cases"].append({"name": "intercepted-" + fault, "result": "PASS"})
            await page.close()
        # A real Host report delayed across loss of its real $events generation must
        # never republish stale identity. Subsequent sockets are explicitly faulted.
        page = await browser.new_page()
        sockets = []
        requested = asyncio.Event()
        release = asyncio.Event()

        async def proxy_socket(route):
            if sockets:
                await route.close(code=1012, reason="injected-disconnect")
            else:
                server = route.connect_to_server()
                sockets.append((route, server))

        async def delayed(route):
            requested.set()
            await release.wait()
            call = route.request.post_data_json
            await route.fulfill(json={"type": "server-response", "rpcId": call["rpcId"],
                                      "result": {"ok": True, "value": {
                                          "status": "blocked", "sessionAdmission": "blocked",
                                          "code": "stale_report_must_not_publish", "missingCapabilities": []}}})

        await page.route_web_socket("**/api/remote.mux", proxy_socket)
        await page.route("**/api/ompDiagnostics/preflight", delayed)
        await page.goto(args.url)
        await asyncio.wait_for(requested.wait(), timeout=15)
        await sockets[0][0].close(code=1012, reason="injected-disconnect")
        await sockets[0][1].close(code=1012, reason="injected-disconnect")
        await page.get_by_text("connection_unavailable", exact=True).wait_for()
        release.set()
        await page.wait_for_timeout(300)
        assert "stale_report_must_not_publish" not in await page.locator("#diagnostic").inner_text()
        assert await page.locator("#diagnostic").get_attribute("data-status") == "blocked"
        results["cases"].append({"name": "intercepted-late-report-after-generation-loss", "result": "PASS"})
        await page.close()
        await browser.close()
    results["screenshotSha256"] = hashlib.sha256((output / "diagnostic.png").read_bytes()).hexdigest()
    (output / "browser.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps({"cases": results["cases"], "browser": results["browser"]}))


parser = argparse.ArgumentParser()
parser.add_argument("url")
parser.add_argument("--evidence", required=True)
parser.add_argument("--expected-code", default="MISSING_CAPABILITIES")
asyncio.run(run(parser.parse_args()))
