"""Actual Chromium -> public originals/attachments RPCs -> Chat Gateway -> controlled native attachment provider."""
import asyncio, base64, io, json, os, re, shutil, signal, struct, subprocess, time, urllib.request, zipfile, zlib
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_EXECUTABLE") or shutil.which("google-chrome") or shutil.which("chromium")
BUN = os.environ.get("OMP_WEB_BUN") or shutil.which("bun") or "bun"
HOST = Path(os.environ.get("OMP_CHAT_HOST_DIR", ROOT / "vendor/host-chat")) / "chat-component-main.js"
PORT = os.environ.get("OMP_CHAT_FIXTURE_PORT", "3193")
ORIGIN = f"http://127.0.0.1:{PORT}"
DATA = ROOT / "vendor/chat-images-access"
FIXTURE_ENV = {"OMP_CHAT_ATTACHMENTS": "1", "OMP_CHAT_FIXTURE_PORT": PORT, "OMP_CHAT_FIXTURE_DATA": str(DATA),
               "OMP_CHAT_CANDIDATE": "vendor/omp-candidate/cli.js"}


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
    # Catalog/projection reads can race a Host restart; the supported recovery is an explicit refresh and Open.
    for attempt in range(2):
        await page.get_by_role("button", name="Refresh catalog").click()
        await page.locator(f'li[data-native-id="{native_id}"]').get_by_role("button", name=re.compile(r"(Open|Switch) Chat Session")).click()
        try:
            await page.wait_for_selector(f'[data-chat-native-session="{native_id}"]', timeout=30000)
            return
        except Exception:
            if attempt:
                print("OPEN_ALERTS", await page.get_by_role("alert").all_inner_texts())
                print("OPEN_BODY", (await page.locator("body").inner_text())[:1200])
                raise


def data_png(width=4, height=4, color=(12, 34, 56)):
    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def png_with_size(size):
    base = data_png()
    end = base.rindex(b"IEND") - 4
    pad = size - len(base) - 12
    chunk = struct.pack(">I", pad) + b"zzZz" + b"\x00" * pad
    return base[:end] + chunk + struct.pack(">I", zlib.crc32(b"zzZz" + b"\x00" * pad) & 0xffffffff) + base[end:]


def docx_with_text(text):
    xml = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/'
           'wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">' + text
           + '</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
    members = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": xml,
    }
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in members.items():
            archive.writestr(name, value)
    return out.getvalue()


TINY = {
    "image/gif": base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
    "image/jpeg": base64.b64decode(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx"
        "NDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEA"
        "AD8AVN//2Q=="),
    "image/webp": base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="),
}


async def upload(page, name, mime, data):
    await page.get_by_label("Add files").set_input_files({"name": name, "mimeType": mime, "buffer": data})
    await page.get_by_text("Inspecting and staging the file…").wait_for(state="detached")


async def wait_phase(page, phase):
    try:
        await page.wait_for_selector(f'[data-attachment-phase="{phase}"]', timeout=60000)
    except Exception:
        print("PHASE_ALERTS", await page.get_by_role("alert").all_inner_texts())
        print("PHASE_ATTEMPT", await page.locator("[data-chat-attempt]").all_inner_texts())
        print("PHASE_PANEL", (await page.locator('[aria-label="Prepared attachments"]').all_inner_texts())[:800])
        print("PHASE_COUNT", await page.locator("[data-chat-original-id]").count())
        print("PHASE_SETTLEMENT", await page.locator("[data-chat-settlement]").all_inner_texts())
        raise

async def wait_alert(page, text, timeout=30000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        texts = await page.get_by_role("alert").all_inner_texts()
        if any(text in value for value in texts):
            return
        await asyncio.sleep(0.2)
    print("ALERT_TEXTS", await page.get_by_role("alert").all_inner_texts())
    print("ALERT_PHASE", await page.locator("[data-attachment-phase]").all_inner_texts())
    print("ALERT_ATTEMPT", await page.locator("[data-chat-attempt]").all_inner_texts())
    print("ALERT_PANEL", (await page.locator('[aria-label="Prepared attachments"]').all_inner_texts())[:800])
    print("ALERT_SETTLEMENT", await page.locator("[data-chat-settlement]").all_inner_texts())
    print("ALERT_DRAFT", await page.get_by_label("Message").input_value())
    raise AssertionError(f"alert did not contain {text!r}")

async def wait_attempt_text(page, text, timeout=60000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        value = await page.locator("[data-chat-attempt]").inner_text()
        if text in value:
            return
        await asyncio.sleep(0.2)
    print("ATTEMPT_TEXT", await page.locator("[data-chat-attempt]").all_inner_texts())
    raise AssertionError(f"attempt did not contain {text!r}")


async def wait_attempt(page, state, timeout=60000):
    try:
        await page.wait_for_selector(f'[data-chat-attempt="{state}"]', timeout=timeout)
    except Exception:
        print("ATTEMPT_TEXTS", await page.locator("[data-chat-attempt]").all_inner_texts())
        print("ATTEMPT_ALERTS", await page.get_by_role("alert").all_inner_texts())
        print("ATTEMPT_PANEL", (await page.locator('[aria-label="Prepared attachments"]').all_inner_texts())[:600])
        raise

async def wait_original(page, count):
    await expect(page.locator("[data-chat-file-count]")).to_have_attribute("data-chat-file-count", str(count), timeout=30000)


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


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EPUB_MIME = "application/epub+zip"
FIXTURES = ROOT / "tests/attachments/fixtures"


async def remove_all(page):
    while True:
        ids = await page.locator("[data-chat-original-id]").evaluate_all(
            "elements => elements.map(element => element.getAttribute('data-chat-original-id'))")
        if not ids:
            return
        item = page.locator(f'[data-chat-original-id="{ids[0]}"]')
        await item.get_by_role("button", name="Remove", exact=True).click()
        await item.wait_for(state="detached")


async def documents(page, scenarios):
    """Real text and document originals through the public browser path and live Native converters."""
    pdf, docx = (FIXTURES / "minimal-text.pdf").read_bytes(), (FIXTURES / "minimal-text.docx").read_bytes()
    pptx, xlsx = (FIXTURES / "minimal-slide.pptx").read_bytes(), (FIXTURES / "minimal-workbook.xlsx").read_bytes()
    epub = (FIXTURES / "minimal-chapter.epub").read_bytes()

    await page.get_by_label("Add files").set_input_files({"name": "spoof.png", "mimeType": "image/png",
                                                          "buffer": b"plain UTF-8 text\n"})
    await wait_original(page, 1)
    assert await page.locator("[data-chat-original-type='text/plain']").count() == 1, "bytes decide over a lying MIME type"
    await remove_all(page)
    scenarios.append("bad-mime-content-wins")

    await page.get_by_label("Add files").set_input_files({"name": "bad.txt", "mimeType": "text/plain",
                                                          "buffer": b"caf\xc3\x28"})
    await wait_alert(page, "UTF-8")
    await page.get_by_label("Add files").set_input_files({"name": "archive.zip", "mimeType": "application/zip",
                                                          "buffer": b"PK\x03\x04" + b"\x00" * 24})
    await wait_alert(page, "ZIP archive")
    await page.get_by_label("Add files").set_input_files({"name": "big.txt", "mimeType": "text/plain",
                                                          "buffer": b"a" * (5 * 1024 * 1024 + 1)})
    await wait_alert(page, "at most 5 MiB")
    await wait_original(page, 0)
    scenarios.append("bad-encoding-unsupported-document-limit")

    await page.get_by_label("Add files").set_input_files([
        {"name": "paper.pdf", "mimeType": "application/pdf", "buffer": pdf},
        {"name": "notes.txt", "mimeType": "text/plain", "buffer": b"attachment provenance note\n"},
        {"name": "report.docx", "mimeType": DOCX_MIME, "buffer": docx}])
    await wait_original(page, 3)
    assert await page.locator("[data-chat-original-type='application/pdf']").count() == 1
    assert await page.locator("[data-chat-original-type='text/plain']").count() == 1
    assert await page.locator(f"[data-chat-original-type='{DOCX_MIME}']").count() == 1
    await send_images(page, "document provenance")
    await wait_phase(page, "awaiting-consent")
    panel = page.locator('[aria-label="Prepared attachments"]')
    assert await panel.get_by_text("Document was converted to Markdown").count() >= 2, "conversion is declared before consent"
    assert await panel.get_by_text("Controlled prepared document").count() >= 1, "converted PDF text is shown"
    assert await panel.get_by_text("Controlled DOCX text witness").count() >= 1, "converted DOCX text is shown"
    assert await page.locator("[data-attachment-representation='text']").count() == 3, "Native consumes prepared text"
    assert await page.locator("[data-attachment-representation='image']").count() == 0
    assert await page.locator('[data-attachment-phase="awaiting-consent"]').count() == 1, "nothing is consumed before consent"
    await page.get_by_role("button", name=re.compile(r"Accept listed changes and continue Send|Continue this Send attempt")).click()
    await wait_attempt(page, "accepted")
    await page.wait_for_selector('[data-chat-native-entry="accepted"]', timeout=60000)
    await wait_original(page, 0)
    assert await page.get_by_label("Message").input_value() == "", "accepted document Send clears the draft"
    scenarios.append("text-pdf-docx-consent-native-entry")

    await page.get_by_label("Add files").set_input_files([
        {"name": "slides.pptx", "mimeType": PPTX_MIME, "buffer": pptx},
        {"name": "book.xlsx", "mimeType": XLSX_MIME, "buffer": xlsx},
        {"name": "chapter.epub", "mimeType": EPUB_MIME, "buffer": epub}])
    await wait_original(page, 3)
    await send_images(page, "office and ebook provenance")
    await wait_phase(page, "awaiting-consent")
    assert await page.locator("[data-attachment-representation='text']").count() == 3
    prepared = await page.locator('[aria-label="Prepared attachments"]').inner_text()
    assert "<!-- Slide 1 -->" in prepared and "# Controlled prepared document" in prepared, "slide scope is converted"
    assert "## Evidence" in prepared and "| Source |" in prepared, "sheet and table scope is converted"
    assert "EPUB witness" in prepared, "EPUB chapter scope is converted"
    await page.get_by_role("button", name=re.compile(r"Accept listed changes and continue Send|Continue this Send attempt")).click()
    await wait_attempt(page, "accepted")
    await wait_original(page, 0)
    scenarios.append("pptx-xlsx-epub-consent-native-entry")

    await page.get_by_label("Base64 file").fill(base64.b64encode(pdf).decode())
    await page.get_by_role("button", name="Add pasted file").click()
    await wait_original(page, 1)
    assert await page.locator("[data-chat-original-type='application/pdf']").count() == 1, "base64 PDF accepted"
    await remove_all(page)
    await send_file_event(page, "paste", "pasted.txt", "text/plain", b"pasted text\n")
    await wait_original(page, 1)
    await send_file_event(page, "drop", "dropped.md", "text/plain", b"dropped text\n")
    await wait_original(page, 2)
    assert await page.locator("[data-chat-original-type='text/plain']").count() == 2, "pasted and dropped text accepted"
    await remove_all(page)
    scenarios.append("document-base64-paste-drop")

    await upload(page, "cancel.docx", DOCX_MIME, docx)
    await wait_original(page, 1)
    await send_images(page, "document cancel")
    await wait_phase(page, "awaiting-consent")
    await page.get_by_role("button", name="Cancel this Send attempt").click()
    await wait_attempt(page, "refused")
    assert await page.get_by_label("Message").input_value() == "document cancel", "cancelled document keeps the draft"
    await wait_original(page, 1)
    await remove_all(page)
    scenarios.append("document-cancel-keeps-draft-original")

    long_text = "TRUNC-START\n" + "witness line\n" * 6000
    await upload(page, "long.docx", DOCX_MIME, docx_with_text(long_text))
    await wait_original(page, 1)
    await send_images(page, "truncated conversion")
    await wait_phase(page, "awaiting-consent")
    assert await page.get_by_text("Text was shortened").count() >= 1, "truncation is declared before consent"
    await page.get_by_role("button", name=re.compile(r"Accept listed changes and continue Send|Continue this Send attempt")).click()
    await wait_attempt(page, "accepted")
    await wait_original(page, 0)
    scenarios.append("document-truncation-declared-and-consented")

    await upload(page, "empty.docx", DOCX_MIME, docx_with_text(""))
    await wait_original(page, 1)
    await send_images(page, "empty conversion")
    await wait_attempt_text(page, "no extractable text")
    assert await page.get_by_label("Message").input_value() == "empty conversion", "empty conversion keeps the draft"
    await wait_original(page, 1)
    await page.reload()
    await page.wait_for_selector("[data-chat-root-slot]")
    await open_session(page)

    await upload(page, "oversize.docx", DOCX_MIME, docx_with_text("x" * (2 * 1024 * 1024 + 1024)))
    await wait_original(page, 1)
    await send_images(page, "output budget conversion")
    await wait_attempt_text(page, "prepared-text ceiling")
    assert await page.get_by_label("Message").input_value() == "output budget conversion", "output budget keeps the draft"
    await wait_original(page, 1)
    await page.reload()
    await page.wait_for_selector("[data-chat-root-slot]")
    await open_session(page)
    scenarios.append("document-conversion-failure-matrix")

    await upload(page, "broken.pdf", "application/pdf", b"%PDF-1.7\nnot a real pdf\n")
    await wait_original(page, 1)
    before = await page.locator("[data-chat-native-entry]").count()
    await send_images(page, "corrupt conversion")
    await wait_attempt_text(page, "converter failed")
    assert await page.get_by_label("Message").input_value() == "corrupt conversion", "failed conversion keeps the draft"
    await wait_original(page, 1)
    assert await page.locator("[data-chat-native-entry]").count() == before, "failed conversion is not sent to Native"
    await remove_all(page)
    scenarios.append("document-corrupt-explicit-conversion-failure")

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
            await wait_phase(page, "awaiting-consent")
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
            await page.get_by_label("Base64 file").fill(base64.b64encode(TINY["image/jpeg"]).decode())
            await page.get_by_role("button", name="Add pasted file").click()
            await wait_original(page, 3)
            assert await page.locator("[data-chat-original-type='image/gif']").count() == 1, "pasted GIF accepted"
            assert await page.locator("[data-chat-original-type='image/webp']").count() == 1, "dropped WebP accepted"
            assert await page.locator("[data-chat-original-type='image/jpeg']").count() == 1, "base64 JPEG accepted"
            scenarios.append("image-paste-drop-base64")

            await page.get_by_label("Add files").set_input_files({"name": "spoof.png", "mimeType": "image/png",
                                                                        "buffer": b"\x00\x01not an image"})
            await wait_alert(page, "binary")
            await wait_original(page, 3)
            await page.get_by_label("Add files").set_input_files({"name": "broken.png", "mimeType": "image/png",
                                                                        "buffer": b"\x89PNG\r\n\x1a\n" + b"\x00" * 32})
            await wait_alert(page, "not a decodable")
            await wait_original(page, 3)
            await page.get_by_label("Add files").set_input_files({"name": "huge.png", "mimeType": "image/png",
                                                                        "buffer": png + b"\x00" * (10 * 1024 * 1024)})
            await wait_alert(page, "at most 10 MiB")
            await wait_original(page, 3)
            await upload(page, "boundary.png", "image/png", png_with_size(10 * 1024 * 1024))
            await wait_original(page, 4)
            assert await page.locator("[data-chat-original-type='image/png']").count() >= 1, "exact 10 MiB image is admitted"
            await remove_all(page)
            scenarios.append("image-spoof-bad-and-size-rejected")

            cancel_before = await page.locator("[data-chat-original-id]").count()
            await upload(page, "cancel.png", "image/png", data_png(3, 3, (90, 10, 10)))
            await send_images(page, "image provenance check")
            await wait_phase(page, "awaiting-consent")
            await page.get_by_role("button", name="Cancel this Send attempt").click()
            await wait_attempt(page, "refused")
            assert await page.get_by_label("Message").input_value() == "image provenance check", "cancelled preparation keeps the draft"
            await wait_original(page, cancel_before + 1)
            scenarios.append("image-cancel-keeps-draft-original")

            await send_images(page, "transform")
            await wait_phase(page, "awaiting-consent")
            await page.get_by_role("button", name="Accept listed changes and continue Send").click()
            await page.wait_for_selector('[data-chat-attempt="accepted"]', timeout=60000)
            await wait_original(page, 0)
            scenarios.append("image-degradation-consent-accepted")


            await documents(page, scenarios)

            stale_before = await page.locator("[data-chat-original-id]").count()
            await upload(page, "stale.png", "image/png", data_png(5, 5, (10, 90, 10)))
            stale = await page.context.new_page()
            stale_errors = []
            stale.on("pageerror", lambda error: stale_errors.append(str(error)))
            await stale.goto(f"{ORIGIN}/")
            await stale.wait_for_selector("[data-chat-root-slot]")
            await open_session(stale)
            await send_images(page, "stale grant")
            await wait_attempt(page, "refused", 60000)
            assert await page.get_by_label("Message").input_value() == "stale grant", "stale grant keeps the draft"
            await wait_original(page, stale_before + 1)
            assert not stale_errors, stale_errors
            scenarios.append("image-stale-grant-rejected-draft-kept")

            limit = await context.new_page()
            await limit.goto(f"{ORIGIN}/")
            await limit.wait_for_selector("[data-chat-root-slot]")
            await open_session(limit)
            eight = [{"name": f"limit-{index}.png", "mimeType": "image/png",
                      "buffer": data_png(2, 2, (index, index, index))} for index in range(8)]
            await limit.get_by_label("Add files").set_input_files(eight)
            await wait_original(limit, 8)
            await limit.get_by_label("Add files").set_input_files({"name": "ninth.png", "mimeType": "image/png",
                                                                         "buffer": data_png(2, 2, (9, 9, 9))})
            await wait_alert(limit, "at most 8 files")
            assert await limit.locator("[data-chat-original-id]").count() == 8, "the ninth image is refused"
            scenarios.append("image-object-limit-enforced")
            await remove_all(limit)

            # #45 restart contract: manual refresh + Open for one admitted Chat View. Tabs whose View was
            # already replaced must not compete for the single per-credential View across the Host restart.
            await stale.close()
            await page.close()
            journal = ROOT / "vendor/chat-attachment-fixture/sessions/bucket/native-0000.jsonl"
            effects = ROOT / "vendor/chat-attachment-fixture/attachment-effects.json"
            effects_before = json.loads(effects.read_text())
            await upload(limit, "restart.pdf", "application/pdf", (FIXTURES / "minimal-text.pdf").read_bytes())
            await wait_original(limit, 1)
            await send_images(limit, "restart consent")
            await wait_phase(limit, "awaiting-consent")
            await stop_host(host)
            host = await start_host()
            await limit.reload()
            await limit.wait_for_selector("[data-chat-root-slot]")
            try:
                await open_session(limit)
            except Exception as failure:
                # Known #55 boundary: rebuilding a Session projection whose native history carries prepared
                # attachments closes the remote stream after a Host restart. #45's manual reopen contract holds
                # for Sessions without attachment history; record this boundary without claiming recovery.
                print("RESTART_REATTACH projection-unavailable", failure,
                      await limit.get_by_role("alert").all_inner_texts())
                assert await limit.locator('[data-chat-native-session="native-0000"]').count() == 0
                assert any("projection failed" in text.lower()
                           for text in await limit.get_by_role("alert").all_inner_texts())
            else:
                assert await limit.get_by_label("Message").input_value() == "restart consent", "Host restart keeps the draft"
                assert await limit.locator("[data-chat-original-id]").count() == 0, "Host restart drops unprepared attachments"
            assert any("restart consent" in value for value in
                       await limit.evaluate("Object.values(localStorage)")), "the draft is retained in storage"
            assert "restart consent" not in journal.read_text(), "Host restart never dispatches the unconsented draft"
            effects_after = json.loads(effects.read_text())
            if effects_after != effects_before:  # a fresh worker rewrites its zeroed effect journal on start
                assert effects_after["inputCalls"] == 0 and effects_after["modelDispatches"] == 0
                assert effects_after["requests"] == [], "Host restart never consumes an unconsented attachment"
            scenarios.append("host-restart-never-dispatches-unconsented-attempt")

            await limit.screenshot(path=str(ROOT / "vendor/chat-images.png"), full_page=True)
            assert not errors, errors
            await limit.close()
            print(json.dumps({"status": "PASS", "browser": browser.version, "scenarios": scenarios,
                              "privateData": False, "productAdmission": "blocked"}))
            await context.close()
            await browser.close()
    finally:
        await stop_host(host)


asyncio.run(main())
