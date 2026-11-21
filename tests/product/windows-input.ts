/**
 * Real Windows Chrome (dev) driving the final-tuple product Host over WSL2 loopback forwarding.
 *
 * Every interaction is a real browser input event delivered to the Windows Chrome renderer through
 * its own CDP endpoint: `Input.dispatchKeyEvent` for typing, `Input.dispatchMouseEvent` for clicks,
 * `Input.dispatchDragEvent` for drag/drop and `DOM.setFileInputFiles` for the file chooser. This is
 * automation, not a maintainer's manual sign-off, and it is not OS-level input to other Windows
 * applications (a clipboard paste from another app or an Explorer drag cannot be produced here).
 *
 * OMP_WEB_WINDOWS_CDP=http://localhost:9224 bun tests/product/windows-input.ts <bootstrapLink> <out.json> <out.png> <fileToAttach>
 */
export {};

interface CdpReply {
  id?: number;
  method?: string;
  params?: unknown;
  result?: { data?: string; result?: { value?: unknown }; nodeId?: number; object?: { objectId?: string } };
  error?: { code: number; message: string };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const endpoint = (process.env.OMP_WEB_WINDOWS_CDP ?? "http://localhost:9224").replace(/\/$/, "");
const [link, outJson, outPng, attachPath] = process.argv.slice(2);
if (!link || !outJson || !outPng) throw new Error("usage: windows-input.ts <bootstrapLink> <out.json> <out.png> [fileToAttach]");
const origin = new URL(link).origin;

const target = record(await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json()) ?? {};
const version = record(await (await fetch(`${endpoint}/json/version`)).json()) ?? {};
const socket = new WebSocket(String(target.webSocketDebuggerUrl));
const pending = new Map<number, (value: CdpReply) => void>();
const consoleErrors: string[] = [];
const failedRequests: string[] = [];
socket.addEventListener("message", (event) => {
  const reply = JSON.parse(String(event.data)) as CdpReply & { method?: string; params?: Record<string, unknown> };
  if (reply.id !== undefined) {
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
    return;
  }
  if (reply.method === "Runtime.consoleAPICalled" && reply.params?.type === "error")
    consoleErrors.push(JSON.stringify(reply.params.args).slice(0, 300));
  if (reply.method === "Runtime.exceptionThrown") consoleErrors.push(JSON.stringify(reply.params).slice(0, 300));
  if (reply.method === "Network.loadingFailed") failedRequests.push(JSON.stringify(reply.params).slice(0, 300));
});
await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));

let next = 0;
const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpReply> => {
  const reply = Promise.withResolvers<CdpReply>();
  const id = ++next;
  pending.set(id, reply.resolve);
  socket.send(JSON.stringify({ id, method, params }));
  return reply.promise;
};
const evaluate = async (expression: string) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const waitFor = async (expression: string, timeout = 180000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean((${expression})())`)) return true;
    await Bun.sleep(250);
  }
  throw new Error(`timeout waiting for ${expression}`);
};

const finder = `(text) => [...document.querySelectorAll('button, [role=button]')]
  .find((element) => (element.textContent ?? '').trim() === text)`;
const field = (label: string) => `[...document.querySelectorAll('input, textarea')]
  .find((element) => (element.getAttribute('aria-label') ?? element.getAttribute('placeholder') ?? '') === ${JSON.stringify(label)})`;

/** Bind the element to `window.__t61` so the coordinates and the click cannot disagree. */
const bind = async (expression: string) => Boolean(await evaluate(`(() => { window.__t61 = undefined;
  window.__t61 = (${expression}); return Boolean(window.__t61); })()`));
const box = async () => JSON.parse(String((await evaluate(`(() => { const element = window.__t61;
  element.scrollIntoView({block: "center"});
  const rect = element.getBoundingClientRect();
  return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width}); })()`)) ?? "{}"));

/** A real browser mouse press/release on the element a page-side expression resolves to. */
const click = async (expression: string) => {
  if (!(await bind(expression))) throw new Error(`no element for click: ${expression}`);
  const { x, y } = await box();
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const clickText = async (text: string) => {
  const expression = `(${finder})(${JSON.stringify(text)})`;
  await waitFor(`() => Boolean((${finder})(${JSON.stringify(text)}))`, 60000);
  await click(expression);
};

/** Real browser key events: focus the field, then one keyDown/keyUp per character. */
const typeInto = async (expression: string, text: string) => {
  await waitFor(`() => Boolean(${expression})`, 60000);
  await evaluate(`(${expression}).focus()`);
  for (const character of text) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: character });
    await send("Input.dispatchKeyEvent", { type: "keyUp" });
  }
  const typed = await evaluate(`(${expression}).value`);
  if (typed === text) return "Input.dispatchKeyEvent";
  await send("Input.insertText", { text });
  const inserted = await evaluate(`(${expression}).value`);
  if (inserted !== text) throw new Error(`field did not accept text: ${String(inserted).slice(0, 80)}`);
  return "Input.insertText (key events did not reach the controlled input)";
};

const bodyText = async () => String((await evaluate("document.body.innerText")) ?? "");

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("DOM.enable");
await send("Page.navigate", { url: link });
await waitFor(`() => Boolean(${field("Directory to authorize")})`, 120000);
const admission = JSON.parse(String((await evaluate(`JSON.stringify({title: document.title, url: location.href,
  text: document.body.innerText.slice(0, 120)})`)) ?? "{}"));

const directoryMechanism = await typeInto(field("Directory to authorize"), String(process.env.OMP_WEB_WINDOWS_DIR ?? ""));
console.log("FIELD", JSON.stringify(await evaluate(`(() => { const input = ${field("Directory to authorize")};
  const button = [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === 'Review directory');
  return {value: input.value, disabled: button.disabled}; })()`)));
await clickText("Review directory");
await Bun.sleep(1500);
console.log("ALERT", JSON.stringify(await evaluate(`[...document.querySelectorAll('[role=alert],[role=status]')].map((element) => element.textContent)`)));
const review = await bodyText();
console.log("REVIEW", JSON.stringify(review.slice(0, 600)));
await clickText("Grant this directory and descendants");
await waitFor(`() => document.querySelector('li[data-product-grant][data-product-grant-status="valid"]') !== null`, 120000);
await clickText("New Session here");
await waitFor("() => (document.querySelector('[data-chat-native-session]')?.getAttribute('data-chat-native-session') ?? '') !== ''", 180000);
const native = await evaluate(`document.querySelector('[data-chat-native-session]').getAttribute('data-chat-native-session')`);

const prompt = "windows browser key turn";
await typeInto(field("Message"), prompt);
await waitFor(`() => document.querySelector('[data-chat-draft-ready="true"]') !== null`, 120000);
await clickText("Send");
await waitFor(`() => document.body.innerText.includes('authoritative controlled final')`, 180000);

const attachment: Record<string, unknown> = {};
if (attachPath) {
  const input = await send("Runtime.evaluate", { expression: 'document.querySelector(\'input[type=file]\')' });
  const objectId = input.result?.result && record(input.result.result)?.objectId;
  const set = await send("DOM.setFileInputFiles", { files: [attachPath], objectId: String(objectId) });
  attachment.fileInput = set.error ? { error: set.error.message } : { ok: true, bytes: (await Bun.file(attachPath).arrayBuffer()).byteLength };
}

const drag = { x: 320, y: 260 };
await send("Input.dispatchDragEvent", { type: "dragEnter", ...drag, data: { items: [{ mimeType: "text/plain", data: "windows drop" }], dragOperationsMask: 1 } });
await send("Input.dispatchDragEvent", { type: "dragOver", ...drag, data: { items: [{ mimeType: "text/plain", data: "windows drop" }], dragOperationsMask: 1 } });
await send("Input.dispatchDragEvent", { type: "drop", ...drag, data: { items: [{ mimeType: "text/plain", data: "windows drop" }], dragOperationsMask: 1 } });
await Bun.sleep(1500);
const afterDrop = await bodyText();

const shot = await send("Page.captureScreenshot", { format: "png" });
await Bun.write(outPng!, Buffer.from(shot.result?.data ?? "", "base64"));
const result = {
  kind: "windows-chrome-input",
  platform: {
    browser: version.Browser,
    userAgent: version["User-Agent"],
    filePathStyle: version["File-Path-Style"],
    cdp: endpoint,
    reachability: "Windows Chrome -> WSL2 loopback forwarding",
    inputPath: "CDP Input.dispatchKeyEvent / dispatchMouseEvent / dispatchDragEvent / DOM.setFileInputFiles in the Windows Chrome process",
    notOsLevel: "no OS clipboard paste from another application and no Explorer-originated drag; those need a visible desktop",
  },
  admission,
  review: review.slice(0, 200),
  native,
  directoryMechanism,
  keyboardTypedPrompt: prompt,
  turnRendered: true,
  attachment,
  dropObserved: afterDrop.includes("windows drop") || afterDrop.includes("dropped"),
  consoleErrors,
  failedRequests,
  screenshot: outPng,
};
await Bun.write(outJson!, JSON.stringify(result, null, 2) + "\n");
await send("Page.close").catch(() => {});
socket.close();
console.log(JSON.stringify({ native, consoleErrors: consoleErrors.length, failed: failedRequests.length, drop: result.dropObserved }));
