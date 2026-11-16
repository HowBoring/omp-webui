/** Matched native SDK data operations complement public RPC recovery; Host never imports native code. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { controlledRuntime, decodeSubmission, terminalSubmission, submissionHistory } from "./fixture.ts";
import { z } from "zod";
import { nativeFixture } from "../catalog/fixture.ts";
import { isolatedRuntimeArgs, negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
const recovery = z.object({ target: z.object({ sourceId: z.string(), instanceId: z.string(), nativeSessionId: z.string() }),
  relations: z.array(z.object({ entryId: z.string().optional(), role: z.string() })) });
for (const operation of ["copy", "fork", "branch"] as const) test(`native ${operation} retains origins as inherited facts and refuses to readmit inherited IDs`, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-copy-"));
  try {
    const root = await nativeFixture(home), file = path.join(root, "bucket/native-0000.jsonl"), cwd = path.join(home, "project");
    const selected = await selectedDescriptor(home);
    const command = { type: "submission_submit", inputType: "prompt", message: "transform", preparationId: "literal-prepared", clientSubmissionId: "inherited-key",
      sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId };
    let worker = strictWorker(home, cwd, controlledRuntime);
    let inputEntryId: string;
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      expect(await worker.request(command)).toMatchObject({ success: true });
      const result = await terminalSubmission(worker, command.clientSubmissionId);
      const input = result.relations.find(relation => relation.role === "input" && relation.entryId);
      if (!input?.entryId) throw Error("NATIVE_INPUT_RELATION_MISSING");
      inputEntryId = input.entryId;
      expect(result).toMatchObject({ terminal: true, persistence: "committed", inputOutcome: "generated" });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    const source = path.resolve("vendor/omp/packages/coding-agent/src/session/session-manager.ts");
    const script = `import {SessionManager} from ${JSON.stringify(source)};
const manager=await SessionManager.open(${JSON.stringify(file)},undefined,undefined,{throwIfMissing:true,suppressBreadcrumb:true});
try {
 let result;
 if (${JSON.stringify(operation)} === "copy") { const copied=await manager.persistCopy({sessionDir:${JSON.stringify(path.dirname(file))},suppressBreadcrumb:true});try{result=copied.getSessionFile();}finally{await copied.close();} }
 else if (${JSON.stringify(operation)} === "branch") {result=manager.createBranchedSession(${JSON.stringify(inputEntryId!)});await manager.flush();}
 else {result=(await manager.fork()).newSessionFile;await manager.flush();}
 console.log(JSON.stringify({file:result}));
}finally{await manager.close();}`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", path.resolve("compatibility/omp/fixtures/no-provider.ts"), "-e", script], {
      cwd, env: { HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, stdout: "pipe", stderr: "pipe" });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw Error(errors);
    const copiedFile = z.object({ file: z.string() }).parse(JSON.parse(output)).file;
    worker = strictWorker(home, cwd, isolatedRuntimeArgs, copiedFile);
    try {
      await negotiateStrict(worker);
      const query = await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId });
      const decoded = decodeSubmission(query);
      const target = recovery.parse(query.data).target;
      expect(decoded.relations).toContainEqual(expect.objectContaining({ entryId: inputEntryId!, role: "input", availability: "retained", persistence: "committed" }));
      expect(target.nativeSessionId).not.toBe(selected.nativeSessionId);
      expect((await submissionHistory(worker)).find(item => item.id === inputEntryId)?.submission)
        .toEqual({ origin: { sourceId: selected.sourceId, instanceId: selected.instanceId,
          nativeSessionId: selected.nativeSessionId, clientSubmissionId: command.clientSubmissionId }, role: "input" });
      expect(query).toMatchObject({ success: true, data: { found: true, admission: "inherited", terminal: true, inputOutcome: "generated",
        origin: { nativeSessionId: selected.nativeSessionId, instanceId: selected.instanceId } } });
      expect(await worker.request({ ...command, ...target })).toMatchObject({ success: false, code: "SUBMISSION_CONFLICT" });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);
