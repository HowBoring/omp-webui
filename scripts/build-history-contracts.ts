/** Invoked after canonical candidate generation; no private native runtime import in Host. */
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
const schema = await Bun.file("vendor/omp/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json").json();
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } });
ajv.addSchema(schema);
for (const [file, name] of Object.entries({ "history-open": "HistoryOpen", "history-page": "HistoryPage", "history-poll": "HistoryPoll" })) {
  const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
  await Bun.write(`packages/contracts/generated/${file}.js`, standaloneCode(ajv, validate));
  await Bun.write(`packages/contracts/generated/${file}.d.ts`, "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
await Bun.write("packages/contracts/generated/omp-wire.ts", await Bun.file("vendor/omp/packages/coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts").text());
