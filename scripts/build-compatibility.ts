import { mkdir, rm, symlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { makeCommandSchemas } from "./command-schemas.ts";
import { digest } from "../packages/compatibility/installation.ts";

import type { RpcWireBundle } from "@oh-my-pi/pi-coding-agent/modes/rpc/wire/index";
import { verifySource, ompBase as base } from "./omp-source.ts";

const checkGenerated = process.argv.includes("--check");
async function emit(path: string, text: string): Promise<void> {
  if (checkGenerated) {
    if (await Bun.file(path).text() !== text) throw new Error("OMP_GENERATED_ARTIFACT_STALE");
  } else await Bun.write(path, text);
}
const omp = resolve("vendor/omp");
const output = resolve("vendor/omp-candidate");
const source = join(omp, "packages/coding-agent/src");
const { patchText, sourceSha256 } = await verifySource(omp);
if (!checkGenerated) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
}
const { buildRpcWireBundle }: { buildRpcWireBundle(): RpcWireBundle } =
  await import(join(source, "modes/rpc/wire/index.ts"));
const { generateRpcArtifacts }: { generateRpcArtifacts(): Map<string, string> } =
  await import(join(omp, "packages/coding-agent/scripts/gen-rpc/index.ts"));
const publicDecoder = await Bun.file(new URL(import.meta.resolve("@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame"))).text();
if (publicDecoder !== await Bun.file(join(source, "modes/rpc/rpc-frame.ts")).text()) {
  throw new Error("OMP_PUBLIC_DECODER_SOURCE_MISMATCH");
}
const bundle = buildRpcWireBundle();
for (const [path, text] of generateRpcArtifacts()) await Bun.write(path, text);
const schemaText = JSON.stringify(bundle, null, 2) + "\n";
if (!checkGenerated) await Bun.write(join(output, "rpc-wire.schema.json"), schemaText);
const schema = digest(schemaText);
const patchSha256 = digest(patchText);
const ajv = new Ajv2020({ strict: false, code: { source: true, esm: true }, allErrors: false });
ajv.addSchema(bundle);
const definition = (name: string) => ({ $ref: `${bundle.$id}#/$defs/${name}` });
const catalogSchemas = makeCommandSchemas(bundle, ["catalog_sources", "catalog_page", "describe_session", "negotiate_protocol"]);
const commandSchemas = makeCommandSchemas(bundle, ["get_compatibility", "negotiate_protocol"]);
// This S0 client deliberately validates only marker-free preflight definitions. Later
// Session unions require a separately implemented policy for the upstream leniency markers.
const audited = new Set<string>();
function audit(node: unknown): void {
  if (Array.isArray(node)) { for (const child of node) audit(child); return; }
  if (typeof node !== "object" || node === null) return;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("x-")) throw new Error("OMP_UNSUPPORTED_VALIDATION_MARKER");
    if (key === "$ref" && typeof child === "string" && child.startsWith("#/$defs/")) {
      const name = child.slice(8);
      if (!audited.has(name)) { audited.add(name); audit(bundle.$defs[name]); }
    } else audit(child);
  }
}
for (const name of ["ReadyEvent", "RpcResponse", "CompatibilityReport", "NegotiateProtocolResult"]) audit(bundle.$defs[name]);
for (const commandSchema of commandSchemas) audit(commandSchema);
const commandValidator = ajv.compile({ anyOf: commandSchemas });
await Bun.write(join(source, "modes/rpc/preflight-validator.generated.js"), standaloneCode(ajv, commandValidator));
for (const name of ["CatalogSources", "CatalogPage", "CatalogDescription"]) audit(bundle.$defs[name]);
for (const schema of catalogSchemas) audit(schema);
const catalogValidator = ajv.compile({anyOf:catalogSchemas});
const catalogOutputs = {page:"CatalogPage",sources:"CatalogSources",description:"CatalogDescription"};
await Bun.write(join(source,"modes/rpc/catalog-command.generated.js"),standaloneCode(ajv,catalogValidator));
for (const [name,def] of Object.entries(catalogOutputs)) {
  const code = standaloneCode(ajv,ajv.compile(definition(def)));
  await Bun.write(join(source,`modes/rpc/catalog-${name}.generated.js`),code);
  await emit(`packages/contracts/generated/catalog-${name}.js`,code);
  await emit(`packages/contracts/generated/catalog-${name}.d.ts`,"declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
await emit("packages/contracts/generated/catalog-command.js",standaloneCode(ajv,catalogValidator));
await emit("packages/contracts/generated/catalog-command.d.ts","declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
await Bun.write(join(source,"modes/rpc/catalog.generated.ts"),`// Generated from authored catalog wire.\n` +
  `import command from "./catalog-command.generated.js";\n` +
  `import page from "./catalog-page.generated.js";\nimport sources from "./catalog-sources.generated.js";\nimport description from "./catalog-description.generated.js";\n` +
  `import type { CatalogCommand } from "./catalog-client";\nimport type { CatalogPage,CatalogSources,CatalogDescription,RpcWireCommands } from "./wire/rpc-wire.generated";\n` +
  `export const validateCatalogCommand = (v:unknown):v is CatalogCommand | ({id:string;type:"negotiate_protocol"} & RpcWireCommands["negotiate_protocol"]["params"]) => command(v);\n` +
  `export const validCatalogPage = (v:unknown):v is CatalogPage => page(v);\nexport const validCatalogSources = (v:unknown):v is CatalogSources => sources(v);\nexport const validCatalogDescription = (v:unknown):v is CatalogDescription => description(v);\n`);
await emit("packages/contracts/generated/catalog-client.ts",(await Bun.file(join(source,"modes/rpc/catalog-client.ts")).text()).replace("./wire/rpc-wire.generated","./omp-wire"));
await emit("packages/contracts/generated/catalog.generated.ts",(await Bun.file(join(source,"modes/rpc/catalog.generated.ts")).text()).replaceAll("./catalog-command.generated.js","./catalog-command.js").replaceAll("./catalog-page.generated.js","./catalog-page.js").replaceAll("./catalog-sources.generated.js","./catalog-sources.js").replaceAll("./catalog-description.generated.js","./catalog-description.js").replaceAll("./wire/rpc-wire.generated","./omp-wire"));
const strictSchemas = makeCommandSchemas(bundle, ["strict_start", "get_strict_state", "cancel_strict_start", "negotiate_protocol"]);
for (const strictSchema of strictSchemas) audit(strictSchema);
audit(bundle.$defs.StrictStartState);
await emit("packages/contracts/generated/catalog-descriptor.js", standaloneCode(ajv, ajv.compile(definition("CatalogDescriptor"))));
await emit("packages/contracts/generated/catalog-descriptor.d.ts", "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
const strictNotificationDefinitions = ["AdvisorCostChangedEvent", "AvailableCommandsUpdateEvent", "SessionSettledEvent", "NoticeEvent"];
for (const name of strictNotificationDefinitions) audit(bundle.$defs[name]);
await emit("packages/contracts/generated/strict-notification.js", standaloneCode(ajv,
  ajv.compile({ anyOf: strictNotificationDefinitions.map(definition) })));
await emit("packages/contracts/generated/strict-notification.d.ts", "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
const strictCommandCode = standaloneCode(ajv, ajv.compile({ anyOf: strictSchemas }));
const strictStateCode = standaloneCode(ajv, ajv.compile(definition("StrictStartState")));
await Bun.write(join(source, "modes/rpc/strict-command.generated.js"), strictCommandCode);
await Bun.write(join(source, "modes/rpc/strict-state.generated.js"), strictStateCode);
await emit("packages/contracts/generated/strict-command.js", strictCommandCode);
await emit("packages/contracts/generated/strict-state.js", strictStateCode);
for (const name of ["strict-command", "strict-state"]) await emit(`packages/contracts/generated/${name}.d.ts`,
  "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
await Bun.write(join(source, "modes/rpc/strict.generated.ts"),
  `import command from "./strict-command.generated.js";\nimport state from "./strict-state.generated.js";\n` +
  `import type { RpcWireCommands,StrictStartState } from "./wire/rpc-wire.generated";\n` +
  `type StrictName = "strict_start" | "get_strict_state" | "cancel_strict_start" | "negotiate_protocol";\n` +
  `export type StrictCommand = {[K in StrictName]:{id:string;type:K} & (RpcWireCommands[K]["params"] extends undefined ? object : RpcWireCommands[K]["params"])}[StrictName];\n` +
  `export const validateStrictCommand = (value:unknown):value is StrictCommand => command(value);\n` +
  `export const validateStrictState = (value:unknown):value is StrictStartState => state(value);\n`);
await emit("packages/contracts/generated/strict-client.ts", (await Bun.file(join(source, "modes/rpc/strict-client.ts")).text())
  .replace("./wire/rpc-wire.generated", "./omp-wire"));
const build = { base, sourceSha256, patchSha256, schemaSha256: schema };
await Bun.write(join(source, "modes/rpc/preflight.generated.ts"), `// Generated by scripts/build-compatibility.ts\n` +
  `import validate from './preflight-validator.generated.js';\n` +
  `import type { RpcWireCommands } from './wire/rpc-wire.generated';\n` +
  `type Command = {id:string;type:'get_compatibility'} | ` +
  `({id:string;type:'negotiate_protocol'} & RpcWireCommands['negotiate_protocol']['params']);\n` +
  `export function validateCommand(value:unknown):value is Command { return validate(value); }\n` +
  `export const compatibilityBuild = ${JSON.stringify(build)};\n`);
if (!checkGenerated) {
const built = await Bun.build({
  entrypoints: [join(source, "cli.ts")], target: "bun", outdir: output, splitting: true,
  plugins: [{ name: "deferred-ordinary-cli", setup(build) {
    build.onResolve({ filter: /^\.\/attachments\/(worker|deny-network)$/ }, ({ path: entry }) => ({
      path: `../omp/packages/coding-agent/src/${entry.slice(2)}.ts`, external: true,
    }));
    build.onResolve({ filter: /^\.\/modes\/rpc\/strict-mode$/ }, () => ({
      path: "../omp/packages/coding-agent/src/modes/rpc/strict-mode.ts", external: true,
    }));
    build.onResolve({ filter: /^\.\/modes\/rpc\/catalog-mode$/ }, () => ({
      path: "../omp/packages/coding-agent/src/modes/rpc/catalog-mode.ts", external: true,
    }));
    build.onResolve({ filter: /^\.\/cli-runtime$/ }, () => ({
      path: "../omp/packages/coding-agent/src/cli-runtime.ts", external: true,
    }));
  } }],
});
if (!built.success) throw new AggregateError(built.logs, "candidate build failed");
try { await rm(join(output, "omp")); } catch {}
await symlink("cli.js", join(output, "omp"));
console.info(JSON.stringify({ status: "candidate-built", ...build, files: built.outputs.length }));

}

// The runtime startup-fast interaction dispatcher validates the same authored public command schema.
const interactionSchemas = makeCommandSchemas(bundle,
  ["get_interaction_policy", "respond_ui", "negotiate_protocol"], { requireId: false });
for (const schema of interactionSchemas) audit(schema);
for (const name of ["InteractionPolicy", "UIReplyResult"]) audit(bundle.$defs[name]);
const interactionValidator = ajv.compile({ $defs: bundle.$defs, anyOf: interactionSchemas });
const interactionValidatorCode = standaloneCode(ajv, interactionValidator);
await Bun.write(join(source, "modes/rpc/interactions-command.generated.js"), interactionValidatorCode);
await Bun.write(join(source, "modes/rpc/interactions.generated.ts"),
  `// Generated from authored wire/interactions.ts.\n` +
  `import validate from './interactions-command.generated.js';\n` +
  `import policy from './interactions-policy.generated.js';\n` +
  `import result from './interactions-result.generated.js';\n` +
  `import type { RpcUIAnswer, RpcInteractionPolicy, RpcUIReplyResult } from './rpc-interactions';\n` +
  `type Command = {id?:string;type:'get_interaction_policy'} | {id?:string;type:'respond_ui';targetId:string;answer:RpcUIAnswer} | {id?:string;type:'negotiate_protocol';protocolVersion:number};\n` +
  `export function validateInteractionCommand(value:unknown):value is Command { return validate(value); }\n` +
  `export function validInteractionPolicy(value:unknown):value is RpcInteractionPolicy { return policy(value); }\n` +
  `export function validInteractionResult(value:unknown):value is RpcUIReplyResult { return result(value); }\n`);
await Bun.write(join(source,"modes/rpc/interactions-policy.generated.js"),standaloneCode(ajv,ajv.compile(definition("InteractionPolicy"))));
await Bun.write(join(source,"modes/rpc/interactions-result.generated.js"),standaloneCode(ajv,ajv.compile(definition("UIReplyResult"))));
for (const name of ["command","policy","result"]) {
  await Bun.write(join(source,`modes/rpc/interactions-${name}.generated.d.ts`),
    "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
await emit("packages/contracts/generated/interaction-command.js", interactionValidatorCode);
await emit("packages/contracts/generated/interaction-command.d.ts",
  "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
for (const [name, definitionName] of Object.entries({"interaction-policy":"InteractionPolicy", "interaction-result":"UIReplyResult", "interaction-request":"ExtensionUiRequest"})) {
  await emit(`packages/contracts/generated/${name}.js`, standaloneCode(ajv, ajv.compile(definition(definitionName))));
  await emit(`packages/contracts/generated/${name}.d.ts`, "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}

const interactionNotices=["AvailableCommandsUpdateEvent","PromptResultEvent","SessionSettledEvent",
  "ExtensionError","SessionInfoUpdateEvent","ConfigUpdateEvent"];
for(const name of interactionNotices)audit(bundle.$defs[name]);
await emit("packages/contracts/generated/interaction-notification.js",
  standaloneCode(ajv,ajv.compile({anyOf:interactionNotices.map(definition)})));
await emit("packages/contracts/generated/interaction-notification.d.ts",
  "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");

// Host contracts/validators are emitted from exactly the schema used by the public candidate.
await mkdir("packages/contracts/generated", { recursive: true });
await emit("packages/contracts/generated/omp-wire.ts",
  await Bun.file(join(source, "modes/rpc/wire/rpc-wire.generated.ts")).text());
await emit("packages/contracts/generated/omp.schema.json", schemaText);
const outputs: Record<string, string> = {};
for (const [name, definitionName] of Object.entries({
  "strict-policy": "StrictStartupPolicy", ready: "ReadyEvent", response: "RpcResponse", report: "CompatibilityReport", negotiated: "NegotiateProtocolResult",
})) {
  const validate = ajv.compile(definition(definitionName));
  const path = `packages/contracts/generated/${name}.js`;
  await emit(path, standaloneCode(ajv, validate));
  outputs[name] = path;
}
await emit("packages/contracts/generated/command.js", standaloneCode(ajv, commandValidator));
for (const name of [...Object.keys(outputs), "command"]) {
  await emit(`packages/contracts/generated/${name}.d.ts`,
    "declare const validate: (value: unknown) => boolean;\nexport default validate;\n");
}
await emit("packages/contracts/generated/identity.ts",
  `// Generated from the same authored source patch and schema.\nexport const compatibilityBuild = ${JSON.stringify(build)};\n`);

// Generate the narrow history public client and validators from this exact matched schema.
await import("./build-history-contracts.ts");

await import("./build-live-contracts.ts");

await import("./build-submission-contracts.ts");
await import("./build-attachment-contracts.ts");
