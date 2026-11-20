process.on("SIGTERM", () => {});
process.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2],
  maxFrameBytes: 262144, maxReassembledFrameBytes: 16777216 }) + "\n");
void (async () => { for await (const bytes of Bun.stdin.stream()) {
  for (const line of new TextDecoder().decode(bytes).trim().split("\n")) {
    const command = JSON.parse(line);
    process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type,
      success: true, data: { protocolVersion: 2 } }) + "\n");
  }
} })();
setInterval(() => {}, 1000);
