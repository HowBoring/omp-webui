/** Narrow supervision-only public RPC command validator from the exact native wire. */
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { makeCommandSchemas } from "./command-schemas.ts";
const schema = await Bun.file("vendor/omp/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json").json();
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } }); ajv.addSchema(schema);
const commands = ["get_state", "abort", "abort_and_restore_queue", "abort_branch_summary", "abort_retry", "abort_bash"];
const code = standaloneCode(ajv, ajv.compile({ $defs: schema.$defs,
  anyOf: makeCommandSchemas(schema, commands, { maxIdLength: 96 }) }));
const target = "packages/contracts/generated/session-controls.js";
if (process.argv.includes("--check")) {
  if (await Bun.file(target).text() !== code) throw new Error("SESSION_CONTROLS_STALE");
} else {
  await Bun.write(target, code);
  await Bun.write(target.replace(".js", ".d.ts"), "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
