/** Same native authored wire supplies the server/client preparation validators. */
import * as path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { makeCommandSchemas } from "./command-schemas.ts";
const root = path.resolve("vendor/omp/packages/coding-agent/src/modes/rpc");
const bundle = await Bun.file(path.join(root, "wire/rpc-wire.schema.json")).json();
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } });
ajv.addSchema(bundle);
const command = standaloneCode(ajv, ajv.compile({ $defs: bundle.$defs,
  anyOf: makeCommandSchemas(bundle, ["attachment_prepare", "attachment_cancel"], { requireId: false, maxIdLength: 96 }) }));
const receipt = standaloneCode(ajv, ajv.compile({ $ref: `${bundle.$id}#/$defs/AttachmentReceipt` }));
async function emit(file: string, text: string): Promise<void> {
  if (process.argv.includes("--check")) {
    if (await Bun.file(file).text() !== text) throw new Error("ATTACHMENT_GENERATED_STALE");
  } else await Bun.write(file, text);
}
for (const [name, code] of Object.entries({ command, receipt })) {
  await Bun.write(path.join(root, `attachment-${name}.generated.js`), code);
  const declaration = "declare const validate: (value: unknown) => boolean;\nexport default validate;\n";
  await Bun.write(path.join(root, `attachment-${name}.generated.d.ts`), declaration);
  await emit(`packages/contracts/generated/attachment-${name}.js`, code);
  await emit(`packages/contracts/generated/attachment-${name}.d.ts`, declaration);
}
await Bun.write(path.join(root, "attachments.generated.ts"),
  'import command from "./attachment-command.generated.js";\nimport receipt from "./attachment-receipt.generated.js";\n' +
  'import type { AttachmentCommand } from "./attachment-client";\nimport type { AttachmentReceipt } from "./wire/rpc-wire.generated";\n' +
  'export const validAttachmentCommand = (value: unknown): value is AttachmentCommand => command(value);\n' +
  'export const validAttachmentReceipt = (value: unknown): value is AttachmentReceipt => receipt(value);\n');
await emit("packages/contracts/generated/attachment-client.ts", (await Bun.file(path.join(root, "attachment-client.ts")).text())
  .replace("./wire/rpc-wire.generated", "./omp-wire"));
