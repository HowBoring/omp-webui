/** One native wire source generates command and result validators for server and public Host client. */
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { makeCommandSchemas } from "./command-schemas.ts";
const root = resolve("vendor/omp/packages/coding-agent/src/modes/rpc");
const bundle = JSON.parse(await Bun.file(resolve("vendor/omp-candidate/rpc-wire.schema.json")).text());
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } });
ajv.addSchema(bundle);
const command = standaloneCode(ajv, ajv.compile({ $defs: bundle.$defs, anyOf: makeCommandSchemas(bundle, ["submission_submit", "submission_query"], { requireId: false }) }));
const result = standaloneCode(ajv, ajv.compile({ $ref: `${bundle.$id}#/$defs/SubmissionResult` }));
for (const [name, code] of Object.entries({ command, result })) {
  await Bun.write(resolve(root, `submission-${name}.generated.js`), code);
  const out = `packages/contracts/generated/submission-${name}.js`;
  if (process.argv.includes("--check")) {
    if (await Bun.file(out).text() !== code) throw new Error("SUBMISSION_GENERATED_STALE");
  } else await Bun.write(out, code);
  await Bun.write(`packages/contracts/generated/submission-${name}.d.ts`, "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
await Bun.write(resolve(root, "submissions.generated.ts"), `import command from "./submission-command.generated.js";\nimport result from "./submission-result.generated.js";\nimport type { SubmissionCommand } from "./rpc-submissions";\nimport type { SubmissionResult } from "./wire/rpc-wire.generated";\nexport const validSubmissionCommand = (value: unknown): value is SubmissionCommand => command(value);\nexport const validSubmissionResult = (value: unknown): value is SubmissionResult => result(value);\n`);
