/** Native branch-boundary command validator from the exact public wire. Not an interaction surface. */
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { makeCommandSchemas } from "./command-schemas.ts";
const schema = await Bun.file("vendor/omp/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json").json();
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } }); ajv.addSchema(schema);
const commands = ["branch", "get_branch_messages"];
const code = standaloneCode(ajv, ajv.compile({ $defs: schema.$defs,
  anyOf: makeCommandSchemas(schema, commands, { maxIdLength: 96 }) }));
const target = "packages/contracts/generated/branch-controls.js";
if (process.argv.includes("--check")) {
  if (await Bun.file(target).text() !== code) throw new Error("BRANCH_CONTROLS_STALE");
} else {
  await Bun.write(target, code);
  await Bun.write(target.replace(".js", ".d.ts"), "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
