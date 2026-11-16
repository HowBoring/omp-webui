/** Isolated browser acceptance fixture. All live native work crosses generated public RPC clients. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { AttachmentBridge } from "../../packages/attachments/bridge.ts";
import { AttachmentTransport } from "../../packages/compatibility/attachment-transport.ts";
import type { AttachmentSelection } from "../../packages/contracts/attachment-remote.ts";
import type { AttachmentFormat } from "../../packages/contracts/attachments.ts";
import { nativeFixture } from "../../tests/catalog/fixture.ts";
import { selectedDescriptor } from "../../tests/continuation/worker.ts";
import { compatibilityBuild } from "../../packages/contracts/generated/identity.ts";

const formats = z.enum(["png", "jpeg", "webp", "gif", "utf8", "pdf", "docx", "pptx", "xlsx", "epub", "broken-utf8", "long-utf8"]);
export const fixtureSelection = z.strictObject({ formats: z.array(formats).min(1).max(8), message: z.string().max(128 * 1024) });
export type FixtureSelection = z.infer<typeof fixtureSelection>;
const metadata = z.array(z.strictObject({ id: formats, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() }));
const mime: Record<AttachmentFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  utf8: "text/plain", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  epub: "application/epub+zip" };
const actualFormat = (id: z.infer<typeof formats>): AttachmentFormat => id === "broken-utf8" || id === "long-utf8" ? "utf8" : id;
interface Draft { selection: AttachmentSelection; owner: string; message: string; generation: string }
/** currentOwner must revalidate an actual authenticated BrowserAuthority identity on every call/publication. */
export class NativeAttachmentFixture {
  readonly bridge: AttachmentBridge;
  readonly #objects;
  #draft: Draft | undefined;
  #revision = 0;
  #revoked = false;
  private constructor(readonly home: string, readonly transport: AttachmentTransport,
    readonly target: { sourceId: string; instanceId: string; nativeSessionId: string },
    readonly currentOwner: () => string, objects: z.infer<typeof metadata>) {
    this.#objects = new Map(objects.map(object => [object.id, object]));
    this.bridge = new AttachmentBridge({ authorize: async selection => {
      const draft = this.#authorize(selection);
      const objects = [];
      for (const originalId of selection.originalIds) {
        const id = formats.parse(originalId.slice("original-".length)), original = this.#objects.get(id);
        if (!original || originalId !== `original-${id}`) throw Error("ATTACHMENT_ORIGINAL_UNAUTHORIZED");
        const bytes = await fs.readFile(path.join(this.home, "originals", id));
        this.#authorize(selection);
        if (bytes.length !== original.bytes || Bun.SHA256.hash(bytes, "hex") !== original.sha256) throw Error("ATTACHMENT_ORIGINAL_CHANGED");
        objects.push({ originalId, format: actualFormat(id), sha256: original.sha256, data: bytes.toBase64() });
      }
      return { target: this.target, draftId: selection.draftId, draftRevision: selection.revision,
        authorityGeneration: draft.generation, message: draft.message, objects };
    } }, () => ({ prepare: input => transport.attachments.prepare(input), cancel: id => transport.attachments.cancel(id),
      submit: input => transport.submissions.submit(input) }));
  }
  static async open(currentOwner: () => string, options: { nativeExpansions?: boolean } = {}): Promise<NativeAttachmentFixture> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-browser-"));
    let transport: AttachmentTransport | undefined;
    try {
      const author = Bun.spawn([process.execPath, "--no-env-file", "--preload", path.resolve("compatibility/omp/fixtures/history-network-guard.js"),
        path.resolve("compatibility/omp/fixtures/attachment-originals.ts")], { env: { HOME: home, PI_CODING_AGENT_DIR: home,
        OMP_HISTORY_FIXTURE_PROFILE: home, PATH: "/usr/bin:/bin", TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
        stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => author.kill("SIGKILL"), 10_000);
      const [code, output, errors] = await Promise.all([author.exited, new Response(author.stdout).text(), new Response(author.stderr).text()]);
      clearTimeout(timer);
      if (code !== 0 || output || errors) throw Error("ATTACHMENT_ORIGINAL_AUTHORING_FAILED");
      await nativeFixture(home);
      if (options.nativeExpansions) {
        const agent = path.join(home, ".omp/agent");
        await fs.mkdir(path.join(agent, "skills", "attachment-proof"), { recursive: true });
        await fs.mkdir(path.join(agent, "commands"), { recursive: true }); await fs.mkdir(path.join(agent, "prompts"), { recursive: true });
        await fs.writeFile(path.join(agent, "skills", "attachment-proof", "SKILL.md"),
          "---\nname: attachment-proof\ndescription: Synthetic native attachment proof\n---\nNATIVE SKILL PROOF with retained attachments.\n");
        await fs.writeFile(path.join(agent, "commands", "attachment-file.md"), "NATIVE FILE EXPANSION $ARGUMENTS");
        await fs.writeFile(path.join(agent, "prompts", "attachment-template.md"), "NATIVE TEMPLATE EXPANSION $ARGUMENTS");
      }
      const selected = await selectedDescriptor(home);
      transport = await AttachmentTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
        path.resolve("compatibility/omp/fixtures/no-provider.ts"), path.resolve("vendor/omp-candidate/cli.js"), "--mode", "rpc-ui", "--strict-start",
        "--offline", "--model", "attachment-controlled/literal", "--no-lsp", ...(options.nativeExpansions ? [] : ["--no-skills"]), "--no-rules", "--no-spotlight", "--no-judge", "--no-context-files",
        "--trusted-extension", path.resolve("compatibility/omp/fixtures/attachment-provider.ts")],
        cwd: path.join(home, "project"), readyTimeoutMs: 10_000,
        env: { HOME: home, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: path.join(home, ".omp/agent"),
          XDG_CONFIG_HOME: path.join(home, "config"), XDG_CACHE_HOME: path.join(home, "cache"), XDG_DATA_HOME: path.join(home, "data"),
          TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", PI_NOTIFICATIONS: "off" } });
      await transport.start({ intent: "continue", reference: selected.reference, expectedCwd: path.join(home, "project") });
      return new NativeAttachmentFixture(home, transport, { sourceId: selected.sourceId, instanceId: selected.instanceId,
        nativeSessionId: selected.nativeSessionId }, currentOwner,
        metadata.parse(await Bun.file(path.join(home, "originals.json")).json()));
    } catch (error) { await transport?.close(); await fs.rm(home, { recursive: true, force: true }); throw error; }
  }
  select(value: FixtureSelection) {
    const owner = this.currentOwner(); if (this.#revoked) throw Error("ATTACHMENT_AUTHORITY_REVOKED");
    const input = fixtureSelection.parse(value);
    const selection = { session: "attachment-projection", draftId: crypto.randomUUID(), revision: String(++this.#revision),
      originalIds: input.formats.map(format => `original-${format}`) };
    this.#draft = { selection, owner, message: input.message, generation: crypto.randomUUID() };
    return { selection, message: input.message, originals: input.formats.map(id => ({ id: `original-${id}`,
      name: `selected.${actualFormat(id) === "utf8" ? "txt" : actualFormat(id)}`, mediaType: mime[actualFormat(id)] })) };
  }
  async original(selection: AttachmentSelection, originalId: string) {
    this.#authorize(selection);
    if (!selection.originalIds.includes(originalId)) throw Error("ATTACHMENT_ORIGINAL_UNAUTHORIZED");
    const id = formats.parse(originalId.slice("original-".length));
    if (originalId !== `original-${id}`) throw Error("ATTACHMENT_ORIGINAL_UNAUTHORIZED");
    const bytes = await fs.readFile(path.join(this.home, "originals", id)); this.#authorize(selection);
    return { data: bytes.toBase64(), mediaType: mime[actualFormat(id)] };
  }
  async submit(request: unknown) {
    const input = z.object({ requestId: z.string().uuid(), sessionId: z.literal("attachment-projection"),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) }).passthrough().parse(request);
    const draft = this.#draft; if (!draft) throw Error("ATTACHMENT_DRAFT_MISSING"); this.#authorize(draft.selection);
    if (input.content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n") !== draft.message) throw Error("ATTACHMENT_DSH_PROMPT_CHANGED");
    const result = await this.bridge.submitForRequest(input.requestId);
    const decoded = z.object({ clientSubmissionId: z.string() }).parse(result);
    void decoded; return result;
  }
  async query(id: string) { this.currentOwner(); return this.transport.submissions.query(id); }
  async effects(): Promise<unknown> { this.currentOwner(); return Bun.file(path.join(this.home, "attachment-effects.json")).json(); }
  revoke(): { revoked: true } { this.currentOwner(); this.#revoked = true; return { revoked: true }; }
  #authorize(selection: AttachmentSelection): Draft {
    const owner = this.currentOwner(), draft = this.#draft;
    if (this.#revoked || !draft || draft.owner !== owner || JSON.stringify(selection) !== JSON.stringify(draft.selection)) {
      throw Error("ATTACHMENT_AUTHORITY_CHANGED");
    }
    return draft;
  }
  async close() { const drain = await this.transport.close(); await fs.rm(this.home, { recursive: true, force: true });
    return { build: compatibilityBuild, drain, kind: "isolated-public-attachment-rpc" }; }
}
