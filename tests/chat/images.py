"""Actual Chromium -> public originals/attachments RPCs -> Chat Gateway -> controlled native attachment provider."""
import asyncio, base64, json, os, re, shutil, signal, struct, subprocess, time, urllib.request, zlib
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = ROOT / "vendor/host-chat/chat-component-main.js"
PORT = os.environ.get("OMP_CHAT_FIXTURE_PORT", "3193")
ORIGIN = f"http://127.0.0.1:{PORT}"
DATA = ROOT / "vendor/chat-images-access"
FIXTURE_ENV = {"OMP_CHAT_ATTACHMENTS": "1", "OMP_CHAT_FIXTURE_PORT": PORT, "OMP_CHAT_FIXTURE_DATA": str(DATA)}


def free_port():
    subprocess.run(["bash", "-c", f"lsof -ti:{PORT} | xargs -r kill -9"], check=False)


async def wait_health(timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{ORIGIN}/healthz", timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            await asyncio.sleep(0.25)
    raise RuntimeError("image Chat Host did not become healthy")


async def start_host():
    env = os.environ.copy()
    env.update(FIXTURE_ENV)
    host = subprocess.Popen([BUN, "--no-env-file", str(HOST)], cwd=ROOT, env=env,
                            stdout=open(ROOT / "vendor/chat-images-host.log", "w"), stderr=subprocess.STDOUT)
    await wait_health()
    return host


def bootstrap():
    env = os.environ.copy()
    env.update(FIXTURE_ENV)
    return subprocess.check_output([BUN, "--no-env-file", str(HOST), "--print-bootstrap"],
                                   cwd=ROOT, env=env, text=True).strip()


async def stop_host(host):
    if host.poll() is None:
        host.send_signal(signal.SIGTERM)
        try:
            host.wait(timeout=10)
        except subprocess.TimeoutExpired:
            host.kill(); host.wait(timeout=5)
    await asyncio.sleep(0.5)


async def grant(page):
    await page.get_by_label("Directory to authorize").fill(str(ROOT / "vendor/chat-fixture/project"))
    await page.get_by_role("button", name="Review directory", exact=True).click()
    await page.get_by_role("button", name="Grant this directory and descendants", exact=True).click()
    await page.get_by_role("button", name="Refresh catalog").click()


async def open_session(page, native_id="native-0000"):
    await page.get_by_role("button", name="Refresh catalog").click()
    await page.locator(f'li[data-native-id="{native_id}"]').get_by_role("button", name=re.compile(r"(Open|Switch) Chat Session")).click()
    try:
        await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=60000)
    except Exception:
        print("OPEN_ALERTS", await page.get_by_role("alert").all_inner_texts())
        print("OPEN_BODY", (await page.locator("body").inner_text())[:1200])
        raise


def data_png(width=4, height=4, color=(12, 34, 56)):
    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


TINY = {
    "image/gif": base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
    "image/jpeg": base64.b64decode(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx"
        "NDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEA"
        "AD8AVN//2Q=="),
    "image/webp": base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="),
}


async def upload(page, name, mime, data):
    await page.get_by_label("Add image files").set_input_files({"name": name, "mimeType": mime, "buffer": data})


async def wait_original(page, count):
    await expect(page.locator("[data-chat-image-count]")).to_have_attribute("data-chat-image-count", str(count), timeout=30000)


async def send_file_event(page, event, name, mime, data):
    payload = base64.b64encode(data).decode()
    await page.evaluate("""([event, name, mime, payload]) => {
      const bytes = Uint8Array.from(atob(payload), value => value.charCodeAt(0));
      const file = new File([bytes], name, {type: mime});
      const transfer = new DataTransfer(); transfer.items.add(file);
      const target = event === 'paste' ? document.querySelector('textarea[aria-label="Message"]') : document.querySelector('[data-chat-worker-id]');
      const init = event === 'paste'
        ? {bubbles: true, cancelable: true, clipboardData: transfer}
        : {bubbles: true, cancelable: true, dataTransfer: transfer};
      target.dispatchEvent(event === 'paste' ? new ClipboardEvent('paste', init) : new DragEvent('drop', init));
    }""", [event, name, mime, payload])


async def send_images(page, text):
    await page.get_by_label("Message").fill(text)
    await page.get_by_role("button", name="Send", exact=True).click()


async def main():
    free_port()
    await asyncio.sleep(0.5)
    subprocess.run([BUN, "--no-env-file", "scripts/create-chat-fixture.ts"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    shutil.rmtree(DATA, ignore_errors=True)
    errors, scenarios = [], []
    link = bootstrap()
    host = await start_host()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
            context = await browser.new_context()
            page = await context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            seen = set()
            def response_log(response):
                if response.status < 400: return
                key = (response.status, response.url.split("?")[0])
                if key in seen: return
                seen.add(key); print("RESPONSE", response.status, response.url[:120])
            page.on("response", response_log)
            page.on("console", lambda message: print("CONSOLE", message.type, message.text[:300])
                    if message.type in ("error", "warning") else None)
            await page.goto(link)
            await page.wait_for_selector("[data-chat-root-slot]")
            await grant(page)
            await open_session(page)

            png = data_png()
            await upload(page, "pixel.png", "image/png", png)
            await wait_original(page, 1)
            assert await page.locator("[data-chat-original-type='image/png']").count() == 1, "PNG original listed"
            assert await page.locator("[data-chat-attempt]").count() == 0, "upload alone does not send"
            assert "Sent" not in await page.locator("body").inner_text(), "upload shows no Sent state"
            scenarios.append("image-upload-staged-no-send")

            await send_images(page, "image provenance check")
            await page.wait_for_selector('[data-attachment-phase="awaiting-consent"]', timeout=60000)
            await page.get_by_role("button", name=re.compile(r"Continue this Send attempt|Accept listed changes and continue Send")).click()
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await page.wait_for_selector('[data-chat-native-entry="accepted"]', timeout=60000)
            await wait_original(page, 0)
            assert await page.get_by_label("Message").input_value() == "", "accepted image Send clears the draft"
            scenarios.append("image-send-consent-accepted-entry")

            await send_file_event(page, "paste", "clip.gif", "image/gif", TINY["image/gif"])
            await wait_original(page, 1)
            await send_file_event(page, "drop", "drop.webp", "image/webp", TINY["image/webp"])
            await wait_original(page, 2)
            await page.get_by_label("Base64 image").fill(base64.b64encode(TINY["image/jpeg"]).decode())
            await page.get_by_role("button", name="Add pasted image").click()
            await wait_original(page, 3)
            assert await page.locator("[data-chat-original-type='image/gif']").count() == 1, "pasted GIF accepted"
            assert await page.locator("[data-chat-original-type='image/webp']").count() == 1, "dropped WebP accepted"
            assert await page.locator("[data-chat-original-type='image/jpeg']").count() == 1, "base64 JPEG accepted"
            scenarios.append("image-paste-drop-base64")

            await page.get_by_label("Add image files").set_input_files({"name": "spoof.png", "mimeType": "image/png",
                                                                        "buffer": b"this is not an image"})
            await expect(page.get_by_role("alert")).to_contain_text("Unsupported image", timeout=30000)
            await wait_original(page, 3)
            await page.get_by_label("Add image files").set_input_files({"name": "broken.png", "mimeType": "image/png",
                                                                        "buffer": b"\x89PNG\r\n\x1a\n" + b"\x00" * 32})
            await expect(page.get_by_role("alert")).to_contain_text("not a decodable", timeout=30000)
            await wait_original(page, 3)
            await page.get_by_label("Add image files").set_input_files({"name": "huge.png", "mimeType": "image/png",
                                                                        "buffer": png + b"\x00" * (10 * 1024 * 1024)})
            await expect(page.get_by_role("alert")).to_contain_text("at most 10 MiB", timeout=30000)
            await wait_original(page, 3)
            scenarios.append("image-spoof-bad-and-size-rejected")

            five = [{"name": f"limit-{index}.png", "mimeType": "image/png",
                     "buffer": data_png(2, 2, (index, index, index))} for index in range(5)]
            await page.get_by_label("Add image files").set_input_files(five)
            await wait_original(page, 8)
            await page.get_by_label("Add image files").set_input_files({"name": "ninth.png", "mimeType": "image/png",
                                                                        "buffer": data_png(2, 2, (9, 9, 9))})
            await expect(page.get_by_role("alert")).to_contain_text("at most 8 images", timeout=30000)
            assert await page.locator("[data-chat-original-id]").count() == 8, "the ninth image is refused"
            for _ in range(8):
                await page.locator("[data-chat-original-id] button").first.click()
            await wait_original(page, 0)
            scenarios.append("image-object-limit-enforced")

            await upload(page, "cancel.png", "image/png", data_png(3, 3, (90, 10, 10)))
            await send_images(page, "image provenance check")
            await page.wait_for_selector('[data-attachment-phase="awaiting-consent"]', timeout=60000)
            await page.get_by_role("button", name="Cancel this Send attempt").click()
            await page.wait_for_selector('[data-chat-attempt="refused"]', timeout=60000)
            assert await page.get_by_label("Message").input_value() == "image provenance check", "cancelled preparation keeps the draft"
            await wait_original(page, 1)
            scenarios.append("image-cancel-keeps-draft-original")

            await send_images(page, "transform")
            await page.wait_for_selector('[data-attachment-phase="awaiting-consent"]', timeout=60000)
            await page.get_by_role("button", name="Accept listed changes and continue Send").click()
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await wait_original(page, 0)
            scenarios.append("image-degradation-consent-accepted")

            await upload(page, "stale.png", "image/png", data_png(5, 5, (10, 90, 10)))
            stale = await context.new_page()
            stale_errors = []
            stale.on("pageerror", lambda error: stale_errors.append(str(error)))
            await stale.goto(f"{ORIGIN}/")
            await stale.wait_for_selector("[data-chat-root-slot]")
            await open_session(stale)
            await send_images(page, "stale grant")
            await expect(page.get_by_role("alert")).to_contain_text("ATTACHMENT_", timeout=60000)
            assert await page.get_by_label("Message").input_value() == "stale grant", "stale grant keeps the draft"
            await wait_original(page, 1)
            assert not stale_errors, stale_errors
            scenarios.append("image-stale-grant-rejected-draft-kept")
            await stale.close()

            await page.screenshot(path=str(ROOT / "vendor/chat-images.png"), full_page=True)
            assert not errors, errors
            print(json.dumps({"status": "PASS", "browser": browser.version, "scenarios": scenarios,
                              "privateData": False, "productAdmission": "blocked"}))
            await context.close()
            await browser.close()
    finally:
        await stop_host(host)


asyncio.run(main())
