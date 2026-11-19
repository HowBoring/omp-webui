import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { digest } from "../packages/compatibility/installation.ts";

export const ompBase = "7c49c11aa5bbaf3f418406583096168ad5b8c6dc";
export const ompPatches = ["0001-safe-preflight.patch", "0002-readonly-catalog.patch", "0003-explicit-interactions.patch", "0004-coherent-history.patch", "0005-strict-continuation.patch", "0006-live-settlement.patch", "0007-durable-submission.patch", "0009-attachment-preparation.patch", "0010-image-original-budget.patch"];
export const authoredPaths = ["src/session/navigation-policy.ts", "src/modes/rpc/rpc-output.ts", "docs/rpc-navigation.md", "src/session/navigation-records.ts", "src/modes/rpc/rpc-navigation.ts", "src/modes/rpc/navigation-client.ts", "src/modes/rpc/wire/navigation.ts", "src/session/session-lease.ts", "src/modes/rpc/rpc-prompt-results.ts", "src/session/turn-recovery.ts", "src/session/session-provider-boundary.ts", "src/session/submission-records.ts", "src/session/submission-policy.ts", "src/session/session-required-features.ts", "src/session/session-artifact-copy.ts", "src/utils/file-new-publication.ts", "src/session/submission-provenance.ts", "src/session/session-entries.ts", "src/modes/rpc/rpc-submissions.ts", "src/modes/rpc/wire/submissions.ts", "src/modes/rpc/submission-client.ts", "docs/rpc-submissions.md", "src/session/history-context.ts", "src/session/agent-session.ts", "src/session/live-message-observation.ts", "src/modes/rpc/rpc-session-events.ts", "docs/rpc-live-observation.md", "README.md", "src/debug/report-bundle.ts", "docs/rpc-strict-start.md", "src/modes/rpc/strict-start-policy.ts", "src/activity/index.ts", "src/memories/index.ts", "src/modes/rpc/rpc-subagents.ts", "src/cli/gc-cli.ts", "src/cli/gc-strip.ts", "src/session/session-header-id.ts", "src/session/session-transfer.ts", "src/cli/render-cli.ts", "src/modes/rpc/strict-client.ts", "src/session/session-drafts.ts", "src/session/session-loader.ts", "src/session/generation-storage-factory.ts", "src/utils/file-xattr.ts", "src/session/session-generation.ts", "src/main.ts", "src/session/session-storage.ts", "src/session/strict-session-storage.ts",
  "src/modes/rpc/wire/strict-start.ts", "src/modes/rpc/strict-mode.ts", "src/modes/rpc/strict-reservation.ts",
  "src/modes/rpc/strict-context.ts", "src/modes/rpc/strict-input.ts", "src/session/session-manager.ts", "src/modes/rpc/history-client.ts",
  "src/modes/rpc/rpc-history.ts", "src/modes/rpc/wire/history.ts", "src/cli.ts", "src/cli-runtime.ts", "src/modes/rpc/preflight.ts",
  "src/modes/rpc/wire/commands.ts", "src/modes/rpc/wire/frames.ts", "src/modes/rpc/wire/index.ts",
  "src/modes/rpc/wire/catalog.ts", "src/modes/rpc/catalog-mode.ts", "src/modes/rpc/catalog-native.ts",
  "src/modes/rpc/rpc-interaction-policy.ts", "src/modes/rpc/rpc-interactions.ts", "src/modes/rpc/rpc-mode.ts", "src/modes/rpc/rpc-types.ts",
  "src/modes/rpc/rpc-client.ts", "src/modes/rpc/wire/interactions.ts", "src/tools/ask.ts",
  "src/extensibility/extensions/types.ts", "docs/rpc-interactions.md", "test/rpc-extension-ui.test.ts", "src/modes/rpc/catalog-metadata.ts", "src/modes/rpc/catalog-path.ts", "src/modes/rpc/catalog-client.ts", "CHANGELOG.md"]
  .map(path => `packages/coding-agent/${path}`).concat([
    "packages/coding-agent/src/attachments/limits.ts", "packages/coding-agent/src/attachments/input-policy.ts", "packages/coding-agent/src/slash-commands/acp-builtins.ts", "packages/coding-agent/src/attachments/prepare.ts",
    "packages/coding-agent/src/attachments/document.ts", "packages/coding-agent/src/attachments/package.ts", "packages/coding-agent/src/attachments/isolated.ts",
    "packages/coding-agent/src/attachments/worker.ts", "packages/coding-agent/src/attachments/deny-network.ts",
    "packages/coding-agent/src/attachments/receipts.ts", "packages/coding-agent/src/markit/types.ts",
    "packages/coding-agent/src/attachments/rpc-budget.ts",
    "packages/coding-agent/src/attachments/validation.ts", "packages/coding-agent/src/attachments/entry-parts.ts",
    "packages/coding-agent/src/attachments/provider-guard.ts", "packages/coding-agent/src/extensibility/extensions/runner.ts",
    "packages/coding-agent/src/session/messages.ts",
    "packages/coding-agent/src/attachments/model-binding.ts", "packages/coding-agent/src/sdk.ts",
    "packages/coding-agent/docs/rpc-attachments.md", "packages/utils/README.md", "packages/utils/CHANGELOG.md",
    "packages/tui/README.md", "packages/tui/CHANGELOG.md",
    "packages/coding-agent/src/markit/converters/pdf/index.ts", "packages/coding-agent/src/markit/converters/docx.ts",
    "packages/coding-agent/src/markit/converters/pptx.ts", "packages/coding-agent/src/markit/converters/xlsx.ts", "packages/coding-agent/src/markit/converters/epub.ts", "packages/utils/src/image-animation.ts",
    "packages/utils/src/stream.ts", "packages/tui/package.json",
    "packages/coding-agent/src/modes/rpc/wire/attachments.ts",
    "packages/coding-agent/src/modes/rpc/attachment-client.ts", "packages/coding-agent/src/modes/rpc/rpc-attachments.ts",
    "packages/coding-agent/src/modes/rpc/rpc-input.ts", "packages/coding-agent/src/modes/rpc/rpc-input-policy.ts",
    "packages/coding-agent/scripts/gen-rpc/model.ts",
    "packages/coding-agent/scripts/gen-rpc/python.ts",
  ]);
const generatedPaths = ["packages/coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts",
  "packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json", "sdk/go/omp-rpc/wire.go",
  "sdk/python/omp-rpc/src/omp_rpc/_wire.py", "sdk/rust/omp-rpc/src/wire.rs"];
export const temporaryPaths = ["packages/coding-agent/src/modes/rpc/navigation.generated.ts", "packages/coding-agent/src/modes/rpc/navigation-command.generated.js", "packages/coding-agent/src/modes/rpc/navigation-result.generated.js", "packages/coding-agent/src/modes/rpc/navigation-preview.generated.js", "packages/coding-agent/src/modes/rpc/attachments.generated.ts", ...["command", "receipt"].flatMap(name => ["js", "d.ts"].map(ext => `packages/coding-agent/src/modes/rpc/attachment-${name}.generated.${ext}`)), "packages/coding-agent/src/modes/rpc/submissions.generated.ts", "packages/coding-agent/src/modes/rpc/submission-command.generated.js", "packages/coding-agent/src/modes/rpc/submission-result.generated.js", "packages/coding-agent/src/modes/rpc/strict-command.generated.js",
  "packages/coding-agent/src/modes/rpc/strict-state.generated.js", "packages/coding-agent/src/modes/rpc/strict.generated.ts", "packages/coding-agent/src/modes/rpc/history.generated.ts",
  ...["command", "open", "page", "poll", "content", "notification"].flatMap(name => ["js", "d.ts"].map(extension => `packages/coding-agent/src/modes/rpc/history-${name}.generated.${extension}`)), "packages/coding-agent/src/modes/rpc/interactions.generated.ts",
  "packages/coding-agent/src/modes/rpc/interactions-command.generated.js",
  "packages/coding-agent/src/modes/rpc/interactions-policy.generated.js",
  "packages/coding-agent/src/modes/rpc/interactions-result.generated.js",
  "packages/coding-agent/src/modes/rpc/interactions-command.generated.d.ts",
  "packages/coding-agent/src/modes/rpc/interactions-policy.generated.d.ts",
  "packages/coding-agent/src/modes/rpc/interactions-result.generated.d.ts","node_modules", "packages/coding-agent/src/modes/rpc/preflight.generated.ts",
  "packages/coding-agent/src/modes/rpc/preflight-validator.generated.js", "packages/coding-agent/src/modes/rpc/catalog.generated.ts",
  "packages/coding-agent/src/modes/rpc/catalog-command.generated.js", "packages/coding-agent/src/modes/rpc/catalog-page.generated.js",
  "packages/coding-agent/src/modes/rpc/catalog-sources.generated.js", "packages/coding-agent/src/modes/rpc/catalog-description.generated.js"];

export function sourceGit(omp:string,...argv:string[]):string {
  const result = Bun.spawnSync(["git","-C",omp,...argv], {env:{PATH:process.env.PATH ?? "/usr/bin:/bin"}});
  if (result.exitCode !== 0) throw new Error("OMP_SOURCE_GIT_FAILED");
  return result.stdout.toString();
}
/** Build the exact ordered patch tree using a private index, leaving the checkout/index untouched. */
export async function patchedTree(omp:string,patches=ompPatches):Promise<string> {
  const temp = await mkdtemp(resolve(tmpdir(),"omp-patch-index-"));
  const git = (...args:string[]):string => {
    const result = Bun.spawnSync(["git","-C",omp,...args], {env:{PATH:process.env.PATH ?? "/usr/bin:/bin",GIT_INDEX_FILE:resolve(temp,"index")}});
    if (result.exitCode !== 0) throw new Error("OMP_ORDERED_PATCH_FAILED");
    return result.stdout.toString().trim();
  };
  try {
    git("read-tree",ompBase);
    for (const patch of patches) git("apply","--cached",resolve("compatibility/omp",patch));
    return git("write-tree");
  } finally { await rm(temp,{recursive:true,force:true}); }
}
/** Refuse undeclared consumed source before importing or executing any upstream generator. */
export async function verifySource(omp:string):Promise<{patchText:string;sourceSha256:string}> {
  if (sourceGit(omp,"rev-parse","HEAD").trim() !== ompBase) throw new Error("OMP_SOURCE_BASE_MISMATCH");
  const allowed = new Set([...authoredPaths,...generatedPaths]);
  for (const file of sourceGit(omp,"diff","HEAD","--name-only").trim().split("\n").filter(Boolean))
    if (!allowed.has(file)) throw new Error("OMP_UNRECORDED_SOURCE_CHANGE");
  for (const file of sourceGit(omp,"ls-files","--others").trim().split("\n").filter(Boolean))
    if (!temporaryPaths.includes(file) && !authoredPaths.includes(file)) throw new Error("OMP_UNRECORDED_SOURCE_FILE");
  sourceGit(omp,"add","-N",...authoredPaths.filter(path => existsSync(resolve(omp,path))));
  const tree = await patchedTree(omp);
  const expected = sourceGit(omp,"diff",ompBase,tree,"--",...authoredPaths);
  const actual = sourceGit(omp,"diff","HEAD","--",...authoredPaths);
  if (actual !== expected) throw new Error("OMP_AUTHORED_PATCH_MISMATCH");
  const patchText = (await Promise.all(ompPatches.map(patch => readFile(resolve("compatibility/omp",patch),"utf8")))).join("");
  return {patchText,sourceSha256:digest(ompBase+"\n"+patchText)};
}
