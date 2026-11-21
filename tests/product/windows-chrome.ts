/**
 * Real Windows Chrome (dev channel) driving the final-tuple product Host over WSL2 loopback
 * forwarding, through the browser's own CDP endpoint. Captures admission, shell render, asset
 * load, console errors and a screenshot. Injects no OS input: that needs a visible desktop.
 *
 * OMP_WEB_WINDOWS_CDP=http://localhost:9224 bun tests/product/windows-chrome.ts <bootstrapLink> <out.json> <out.png>
 */
export {};

interface CdpReply {
  id?: number;
  method?: string;
  params?: unknown;
  result?: { data?: string; result?: { value?: unknown } };
  error?: { code: number; message: string };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const endpoint = (process.env.OMP_WEB_WINDOWS_CDP ?? "http://localhost:9224").replace(/\/$/, "");
const [link, outJson, outPng] = process.argv.slice(2);
if (!link || !outJson || !outPng) throw new Error("usage: windows-chrome.ts <bootstrapLink> <out.json> <out.png>");
const origin = new URL(link).origin;
const readJson = async (path: string): Promise<Record<string, unknown>> =>
  record(await (await fetch(`${endpoint}${path}`)).json()) ?? {};

// Chrome only creates a target for PUT; a GET returns a plain-text refusal.
const target = record(await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json()) ?? {};
const version = await readJson("/json/version");
const consoleErrors: string[] = [];
const failedRequests: string[] = [];
const loaded: string[] = [];

const socket = new WebSocket(String(target.webSocketDebuggerUrl));
const pending = new Map<number, (value: CdpReply) => void>();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as CdpReply;
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  const params = record(message.params);
  const kind = String(params?.type ?? "");
  if (message.method === "Runtime.consoleAPICalled" && kind === "error") {
    const args = Array.isArray(params?.args) ? params.args : [];
    consoleErrors.push(args.map((arg) => String(record(arg)?.value ?? record(arg)?.description ?? "")).join(" "));
  }
  if (message.method === "Runtime.exceptionThrown") {
    const details = record(params?.exceptionDetails);
    consoleErrors.push(String(record(details?.exception)?.description ?? details?.text ?? ""));
  }
  if (message.method === "Network.loadingFailed") failedRequests.push(`${kind} ${String(params?.errorText)}`);
  if (message.method === "Network.responseReceived") {
    const response = record(params?.response);
    loaded.push(`${String(response?.status)} ${String(response?.url)}`);
  }
});
const opened = Promise.withResolvers<void>();
socket.addEventListener("open", () => opened.resolve());
await opened.promise;

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

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Page.navigate", { url: link });
await Bun.sleep(3000);
const admitted = await evaluate(`JSON.stringify({title: document.title, url: location.href,
  text: document.body.innerText.slice(0, 80)})`);
await send("Page.navigate", { url: `${origin}/` });
await Bun.sleep(3000);
const shell = await evaluate(`JSON.stringify({title: document.title, url: location.href,
  text: document.body.innerText.slice(0, 160),
  clientLoaded: performance.getEntriesByType('resource').some((entry) => entry.name.includes('client.js'))})`);
const shot = await send("Page.captureScreenshot", { format: "png" });
await Bun.write(outPng!, Buffer.from(shot.result?.data ?? "", "base64"));
const result = {
  kind: "windows-chrome-product",
  platform: {
    browser: version.Browser,
    userAgent: version["User-Agent"],
    filePathStyle: version["File-Path-Style"],
    cdp: endpoint,
    reachability: "Windows Chrome -> WSL2 loopback forwarding",
  },
  origin,
  admission: JSON.parse(String(admitted ?? "{}")),
  shell: JSON.parse(String(shell ?? "{}")),
  requests: loaded.filter((entry) => entry.includes(origin)),
  failedRequests,
  consoleErrors,
  screenshot: outPng,
  inputInjection: "not run: needs a visible Windows desktop session (OS-level drag/keys); see ticket-61 acceptance",
};
await Bun.write(outJson!, JSON.stringify(result, null, 2) + "\n");
await send("Page.close").catch(() => {});
socket.close();
console.log(JSON.stringify({ shell: result.shell, errors: consoleErrors.length, failed: failedRequests.length }));
