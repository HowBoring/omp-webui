/** Native public data seam: a historical state restore must not make a reserved key executable. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { isolatedRuntimeArgs, negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
import { decodeSubmission } from "./fixture.ts";
test("native state rewind retains permanent reservation and original committed entry facts outside the retained tree", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-rewind-"));
  try {
    const root = await nativeFixture(home), file = path.join(root, "bucket/native-0000.jsonl"), cwd = path.join(home, "project");
    const selected = await selectedDescriptor(home), initial = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(initial);
      await initial.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd });
      await initial.request({ type: "set_session_name", name: "Generation before checkpoint" });
      await initial.close();
    } finally { initial.child.kill(); await initial.child.exited; }
    const managerSource = path.resolve("vendor/omp/packages/coding-agent/src/session/session-manager.ts");
    const provenance = path.resolve("vendor/omp/packages/coding-agent/src/session/submission-provenance.ts");
    const script = `import {SessionManager} from ${JSON.stringify(managerSource)};import {runSubmission} from ${JSON.stringify(provenance)};
const manager=await SessionManager.open(${JSON.stringify(file)},undefined,undefined,{throwIfMissing:true,suppressBreadcrumb:true});
try{
 const snapshot=manager.captureState(), target=manager.getSubmissionTarget(), origin={...target,clientSubmissionId:"rewind-key"};
 await manager.reserveSubmission({origin,fingerprint:"0".repeat(64),preparationId:"literal",terminal:false,inputOutcome:"unresolved",noEntries:[]});
 const id=runSubmission({origin,phase:"input"},()=>manager.appendMessage({role:"user",content:"Input later removed by native rewind",timestamp:1}));
 await manager.completeSubmission(origin,"generated",[]);
 manager.restoreState(snapshot);await manager.rewriteEntries();
 console.log(JSON.stringify({id,leaf:manager.getLeafId(),entries:manager.getEntries().map(entry=>entry.id)}));
}finally{await manager.close();}`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", path.resolve("compatibility/omp/fixtures/no-provider.ts"), "-e", script],
      { cwd, env: { HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, stdout: "pipe", stderr: "pipe" });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw Error(errors);
    const result = JSON.parse(output);
    expect(result.entries).not.toContain(result.id);
    const reopened = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(reopened);
      expect(await reopened.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      const query = decodeSubmission(await reopened.request({ type: "submission_query", clientSubmissionId: "rewind-key" }));
      expect(query.inputOutcome).toBe("generated"); expect(query.terminal).toBe(true);
      expect(query.relations).toContainEqual(expect.objectContaining({ entryId: result.id, availability: "removed", persistence: "committed" }));
      expect(await reopened.request({ type: "submission_submit", inputType: "prompt", message: "Must not reexecute", preparationId: "literal", clientSubmissionId: "rewind-key", ...query.target }))
        .toMatchObject({ success: false, code: "SUBMISSION_CONFLICT" });
      expect((await reopened.close()).code).toBe(0);
    } finally { reopened.child.kill(); await reopened.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);
