/** Same-source history client and validators; called by canonical candidate generation. */
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
const native = "vendor/omp/packages/coding-agent/src/modes/rpc/";
const schema = await Bun.file(native + "wire/rpc-wire.schema.json").json();
const check = process.argv.includes("--check");
async function emit(path: string, text: string): Promise<void> {
  if (check && await Bun.file(path).text() !== text) throw new Error("HISTORY_GENERATED_ARTIFACT_STALE");
  if (!check) await Bun.write(path, text);
}
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } });
ajv.addSchema(schema);
const outputs = { Open: "HistoryOpen", Page: "HistoryPage", Poll: "HistoryPoll", Content: "HistoryContentPage", Notification: "AvailableCommandsUpdateEvent" };
for (const [name, definition] of Object.entries(outputs)) {
  const code = standaloneCode(ajv, ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` }));
  await Bun.write(native + `history-${name.toLowerCase()}.generated.js`, code);
  await Bun.write(native + `history-${name.toLowerCase()}.generated.d.ts`, "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
  await emit(`packages/contracts/generated/history-${name.toLowerCase()}.js`, code);
  await emit(`packages/contracts/generated/history-${name.toLowerCase()}.d.ts`, "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
const names = ["history_snapshot_open", "history_snapshot_page", "history_snapshot_close", "history_observation_poll", "history_content_page", "negotiate_protocol"];
const commands = schema["x-rpc"].commands.filter((command: { name: string }) => names.includes(command.name));
const commandSchema = { $defs: schema.$defs, anyOf: commands.map((command: { name: string; params: string }) => {
  const params = schema.$defs[command.params];
  return { type: "object", additionalProperties: false, required: ["id", "type", ...params.required],
    properties: { id: { type: "string", minLength: 1, maxLength: 96 }, type: { const: command.name }, ...params.properties } };
}) };
const commandCode = standaloneCode(ajv, ajv.compile(commandSchema));
await Bun.write(native + "history-command.generated.js", commandCode);
await Bun.write(native + "history-command.generated.d.ts", "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
await emit("packages/contracts/generated/history-command.js", commandCode);
await emit("packages/contracts/generated/history-command.d.ts", "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
let shared = '// Generated from same-source native history wire.\nimport command from "./history-command.generated.js";\n' +
  'import type { HistoryCommand } from "./history-client";\n' +
  'import type { HistoryOpen,HistoryPage,HistoryPoll,HistoryContentPage,AvailableCommandsUpdateEvent,RpcWireCommands } from "./wire/rpc-wire.generated";\n' +
  'export const validateHistoryCommand = (value:unknown):value is HistoryCommand | ({id:string;type:"negotiate_protocol"}&RpcWireCommands["negotiate_protocol"]["params"]) => command(value);\n';
for (const [name, definition] of Object.entries(outputs)) {
  shared += `import ${name.toLowerCase()} from "./history-${name.toLowerCase()}.generated.js";\n` +
    `export const validHistory${name} = (value:unknown):value is ${definition} => ${name.toLowerCase()}(value);\n`;
}
await Bun.write(native + "history.generated.ts", shared);
for (const filename of ["history-client.ts", "history.generated.ts"]) {
  const code = (await Bun.file(native + filename).text()).replaceAll("./wire/rpc-wire.generated", "./omp-wire")
    .replaceAll(/(history-[a-z]+)\.generated\.js/g, "$1.js");
  await emit("packages/contracts/generated/" + filename, code);
}
