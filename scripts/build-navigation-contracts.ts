/** One native wire source generates command and result validators for server and public Host client. */
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { makeCommandSchemas } from "./command-schemas.ts";
const root = resolve("vendor/omp/packages/coding-agent/src/modes/rpc");
const bundle = JSON.parse(await Bun.file(resolve(root, "wire/rpc-wire.schema.json")).text());
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true } });
ajv.addSchema(bundle);
const command = standaloneCode(ajv, ajv.compile({ $defs: bundle.$defs, anyOf: makeCommandSchemas(bundle, ["navigate_tree_committed", "navigation_query", "navigation_inspect"], { requireId: false }) }));
const preview = standaloneCode(ajv, ajv.compile({ $ref: `${bundle.$id}#/$defs/NavigationPreview` }));
const result = standaloneCode(ajv, ajv.compile({ $ref: `${bundle.$id}#/$defs/NavigationResult` }));
for (const [name, code] of Object.entries({ command, result, preview })) {
  await Bun.write(resolve(root, `navigation-${name}.generated.js`), code);
  const out = `packages/contracts/generated/navigation-${name}.js`;
  if (process.argv.includes("--check")) {
    if (await Bun.file(out).text() !== code) throw new Error("NAVIGATION_GENERATED_STALE");
  } else await Bun.write(out, code);
  await Bun.write(`packages/contracts/generated/navigation-${name}.d.ts`, "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
await Bun.write(resolve(root, "navigation.generated.ts"), `import command from "./navigation-command.generated.js";\nimport result from "./navigation-result.generated.js";\nimport type { NavigationCommand } from "./rpc-navigation";\nimport type { NavigationResult } from "./wire/rpc-wire.generated";\nexport const validNavigationCommand = (value: unknown): value is NavigationCommand => command(value);\nexport const validNavigationResult = (value: unknown): value is NavigationResult => result(value);\n`);
const client = (await Bun.file(resolve(root, "navigation-client.ts")).text()).replace("./wire/rpc-wire.generated", "./omp-wire");
if (process.argv.includes("--check")) {
  if (await Bun.file("packages/contracts/generated/navigation-client.ts").text() !== client) throw new Error("NAVIGATION_CLIENT_STALE");
} else await Bun.write("packages/contracts/generated/navigation-client.ts", client);
