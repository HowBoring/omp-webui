/** Labelled public stdio fault fixture; never substitutes for the native history worker. */
const write = (value: unknown): void => { process.stdout.write(JSON.stringify(value) + "\n"); };
write({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864 });
for await (const line of console) {
  const command: unknown = JSON.parse(line);
  if (typeof command !== "object" || command === null || !("id" in command) || !("type" in command)) continue;
  if (command.type === "negotiate_protocol") {
    write({ type: "response", id: command.id, command: command.type, success: true, data: { protocolVersion: 2 } });
  } else {
    write({ type: "available_commands_update", commands: "SYNTHETIC_PRIVATE_STATE" });
  }
}
export {};
