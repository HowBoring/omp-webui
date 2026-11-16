import { SubmissionClient, isSubmissionResult } from "../../packages/contracts/submissions.ts";
import { compatibilityBuild } from "../../packages/contracts/generated/identity.ts";
/** Fixture-only Bun adapter. All live operations use the actual public native JSONL RPC. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { nativeFixture } from "../../tests/catalog/fixture.ts";
import { selectedDescriptor, strictWorker, negotiateStrict } from "../../tests/continuation/worker.ts";
import { controlledRuntime, decodeSubmission } from "../../tests/submissions/fixture.ts";
const correlation = z.object({ submissionId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/), requestId: z.string().uuid() });
const prompt = z.object({ requestId: z.string().uuid(), sessionId: z.literal("fixture-existing"),
  content: z.array(z.object({ type: z.literal("text"), text: z.string().max(262144) })) });
export class NativeSubmissionFixture {
  readonly correlations = new Map<string, string>();
  readonly effects: object[] = [];
  readonly client = new SubmissionClient(async command => {
    const frame = await this.#worker.request(command);
    if (!frame.success) throw Error(typeof frame.code === "string" ? frame.code : "SUBMISSION_BROWSER_REMOTE_ERROR");
    return frame.data;
  }, isSubmissionResult);
  #worker;
  #selected;
  private constructor(readonly home: string, readonly evidence: string, selected: Awaited<ReturnType<typeof selectedDescriptor>>, worker: ReturnType<typeof strictWorker>) {
    this.#selected = selected; this.#worker = worker;
  }
  static async open(evidence: string) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-browser-"));
    await nativeFixture(home);
    const selected = await selectedDescriptor(home), worker = strictWorker(home, path.join(home, "project"), controlledRuntime, undefined, undefined, path.join(home, "network-initial.strace"));
    const value = new NativeSubmissionFixture(home, evidence, selected, worker);
    await value.#open(); return value;
  }
  async #open() {
    await negotiateStrict(this.#worker);
    const result = await this.#worker.request({ type: "strict_start", intent: "continue", reference: this.#selected.reference, expectedCwd: path.join(this.home, "project") });
    if (!result.success) throw Error("SUBMISSION_BROWSER_NATIVE_OPEN");
  }
  correlate(value: unknown) {
    const { submissionId, requestId } = correlation.parse(value), prior = this.correlations.get(requestId);
    if (prior && prior !== submissionId) throw Error("SUBMISSION_BROWSER_CORRELATION_CONFLICT");
    this.correlations.set(requestId, submissionId); return { correlated: true };
  }
  async submit(value: unknown) {
    const input = prompt.parse(value), clientSubmissionId = this.correlations.get(input.requestId);
    if (!clientSubmissionId) throw Error("SUBMISSION_BROWSER_CORRELATION_MISSING");
    const result = await this.client.submit({ clientSubmissionId,
      sourceId: this.#selected.sourceId, instanceId: this.#selected.instanceId, nativeSessionId: this.#selected.nativeSessionId,
      inputType: "prompt", preparationId: "literal-browser-preparation-v1", message: input.content.map(part => part.text).join("\n") });
    this.effects.push({ requestId: input.requestId, clientSubmissionId, result });
  }
  async query(id: unknown) { return this.client.query(z.string().regex(/^[A-Za-z0-9_-]{1,96}$/).parse(id)); }
  async restart() {
    const drain = await this.#worker.close();
    await fs.copyFile(path.join(this.home, "submission-network-audit.json"), path.join(this.evidence, "initial-network-audit.json"));
    if (drain.code !== 0) throw Error("SUBMISSION_BROWSER_DRAIN_FAILED");
    this.#worker = strictWorker(this.home, path.join(this.home, "project"), controlledRuntime, undefined, undefined, path.join(this.home, "network-restart.strace")); await this.#open();
    return { restarted: true };
  }
  async close() {
    const drain = await this.#worker.close();
    const provider = await Bun.file(path.join(this.home, "submission-provider-effects.json")).json().catch(() => null);
    const traces = [];
    for (const name of ["network-initial.strace", "network-restart.strace"]) {
      const text = await Bun.file(path.join(this.home, name)).text();
      await Bun.write(path.join(this.evidence, name), text);
      traces.push({ name, sha256: Bun.SHA256.hash(text, "hex"), inetConnects: text.split("\n").filter(line => /connect\(.*sa_family=AF_INET6?\b/.test(line)).length,
        inetSends: text.split("\n").filter(line => /send(to|msg)\(.*sa_family=AF_INET6?\b/.test(line)).length });
    }
    const guard = await Bun.file(path.join(this.home, "submission-network-audit.json")).json();
    await Bun.write(path.join(this.evidence, "native.json"), JSON.stringify({ build: compatibilityBuild, traces, guard, kind: "isolated-public-native-rpc", effects: this.effects,
      correlations: [...this.correlations], provider, drain }, null, 2));
    await fs.rm(this.home, { recursive: true, force: true });
  }
}
