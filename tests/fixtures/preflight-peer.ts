/** Public stdio fault fixture. This is never a substitute for candidate runtime evidence. */
const mode = process.argv[2];
const ready = { type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864 };
const write = (value: unknown) => { process.stdout.write(JSON.stringify(value) + "\n"); };
await Bun.sleep(Number(process.argv[3] ?? 0));
write(ready);
const requests: Record<string, unknown>[] = [];
const chunkedStartup = mode === "coalesced-v2" || mode === "chunk-before-ack" || mode === "wrong-ack-then-chunk";
const chunkFrame = (index: number, data: Buffer) => ({ type: "rpc_chunk", chunkId: "coalesced-startup", index,
  count: 5, byteLength: 1048576, data: data.toString("base64") });
for await (const line of console) {
  if (line.length === 0) continue;
  const command: unknown = JSON.parse(line);
  if (typeof command !== "object" || command === null || !("type" in command) || !("id" in command)) {
    throw new Error("invalid fixture command");
  }
  if (command.type === "negotiate_protocol") {
    await Bun.sleep(Number(process.argv[4] ?? 0));
    const ack = { type: "response", id: command.id, command: mode === "wrong-ack-then-chunk" ? "prompt" : command.type,
      success: true, data: { protocolVersion: 2 } };
    if (chunkedStartup) {
      // One sub-PIPE_BUF write forces adjacent frames into one pipe packet: the first chunk has no complete JSON yet.
      const frames = [ack, chunkFrame(0, Buffer.alloc(64, 32))];
      if (mode === "chunk-before-ack") frames.reverse();
      process.stdout.write(frames.map(frame => JSON.stringify(frame) + "\n").join(""));
    } else write(ack);
    if (mode === "never-read") await Bun.sleep(60_000);
    continue;
  }
  const report = {
    candidate: "omp-webui-s0", base: "fixture", sourceSha256: "fixture", patchSha256: "fixture",
    schemaSha256: "fixture", safePreflight: true, sessionAdmission: "blocked", capabilities: ["fixture"],
    runtime: { name: "bun", version: Bun.version, platform: process.platform, arch: process.arch },
  };
  const response = { type: "response", id: command.id, command: command.type, success: true, data: report };
  if (chunkedStartup) {
    // The remaining bytes contain this request's actual correlation ID, padded as valid JSON whitespace.
    const bytes = Buffer.alloc(1048576 - 64, 32);
    bytes.write(JSON.stringify(response));
    for (let offset = 0, index = 1; offset < bytes.length; offset += 262144, index++) {
      write(chunkFrame(index, bytes.subarray(offset, offset + 262144)));
    }
  } else if (mode === "eof-response") { requests.push(response); }
  else if (mode === "out-of-order") {
    requests.push(response);
    if (requests.length === 2) {
      write({ ...response, data: { ...report, capabilities: ["second"] } });
      const first = requests[0];
      write({ ...first, data: { ...report, capabilities: ["first"] } });
    }
  } else if (mode === "wrong-id") write({ ...response, id: "wrong" });
  else if (mode === "wrong-command") write({ ...response, command: "prompt" });
  else if (mode === "invalid-result") write({ ...response, data: { safePreflight: true } });
  else if (mode === "duplicate") { write(response); write(response); }
  else if (mode === "no-response") continue;
  else if (mode === "late") { await Bun.sleep(100); write(response); }
  else write(response);
}
if (mode === "eof-response") for (const response of requests) write(response);
if (mode === "tail") process.stdout.write('{"type":');
if (mode === "invalid-utf8") process.stdout.write(new Uint8Array([255, 10]));
if (mode === "stderr-secret") process.stderr.write("token=secret-fixture-prompt-and-home\n");
if (mode === "hung") await Bun.sleep(60_000);
if (mode === "nonzero") process.exitCode = 7;

export {};
