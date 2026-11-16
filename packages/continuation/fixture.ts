/** Isolated S0 Host adapter. Registers references, supervises one public RPC worker, never reads native Session files. */
import { mkdir, rename, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { brandString } from "@deepseek-ai/dsh-brand";
import { StrictTransport } from "../compatibility/strict-transport.ts";
import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogDescriptor, StrictStartState } from "../contracts/generated/omp-wire.ts";
import { decodeContinuationSnapshot } from "../contracts/continuation.ts";
import type { ContinuationAction, ContinuationSnapshot, ContinuationRegistration, ContinuationSelectionId,
  ContinuationRegistrationId, ContinuationWorkerId } from "../contracts/continuation.ts";
interface Options {
  catalog: CatalogClient; cwd: string; indexFile: string;
  launch(selected?: CatalogDescriptor): Promise<StrictTransport>;
}
interface Active {
  id: ContinuationWorkerId; record: ContinuationRegistration; client: Promise<StrictTransport>;
  selected?: CatalogDescriptor; retired: boolean; drained: boolean; started: boolean;
}
export class ContinuationFixture {
  readonly #choices = new Map<ContinuationSelectionId, CatalogDescriptor>();
  readonly #records: ContinuationRegistration[] = [];
  #active: Active | undefined;
  #starts = 0;
  #state: StrictStartState | undefined;
  #persistence = Promise.resolve();
  #opening: Promise<void> | undefined;
  #openingReference: string | undefined;
  #openingRecord: ContinuationRegistration | undefined;
  #cancelRequested = false;
  constructor(readonly options: Options) {}
  async restore(): Promise<void> {
    let text: string;
    try { text = await readFile(this.options.indexFile, "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    if (Buffer.byteLength(text) > 262_144) throw new Error("STRICT_INDEX_LIMIT");
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 || !("registrations" in value))
      throw new Error("STRICT_INDEX_INVALID");
    const restored = decodeContinuationSnapshot({ sessionAdmission: "blocked", choices: [], registrations: value.registrations,
      worker: { status: "none", starts: 0 } });
    for (const record of restored.registrations) {
      if (["opening", "open", "cancelling"].includes(record.attempt)) { record.attempt = "outcome_unknown"; record.code = "STRICT_HOST_RESTARTED"; }
      this.#records.push(record);
    }
  }
  snapshot(): ContinuationSnapshot {
    const active = this.#active;
    return { sessionAdmission: "blocked", choices: [...this.#choices].map(([selectionId, descriptor]) => ({ selectionId, descriptor })),
      registrations: this.#records.map(record => ({ ...record })),
      worker: { status: !active ? "none" : active.drained ? "closed" : active.retired || ["cancelled", "cancelling", "failed"].includes(active.record.attempt) ? "closing" : active.record.attempt === "open" ? "open"
        : active.record.attempt === "outcome_unknown" ? "outcome_unknown" : "opening", starts: this.#starts,
        ...(active ? { id: active.id } : {}) }, ...(this.#state ? { state: this.#state } : {}) };
  }
  async #save(): Promise<void> {
    const bytes = JSON.stringify({ version: 1, registrations: this.#records });
    this.#persistence = this.#persistence.then(async () => {
      await mkdir(dirname(this.options.indexFile), { recursive: true, mode: 0o700 });
      const temporary = this.options.indexFile + ".tmp";
      await Bun.write(temporary, bytes, { mode: 0o600 }); await rename(temporary, this.options.indexFile);
    });
    await this.#persistence;
  }
  async #discover(): Promise<void> {
    let cursor: string | undefined, requests = 0;
    do {
      const page = await this.options.catalog.page({ pageSize: 32, ...(cursor ? { cursor } : {}) });
      for (const descriptor of page.items) {
        const existing = [...this.#choices].find(([, item]) => item.reference === descriptor.reference);
        if (existing) this.#choices.set(existing[0], descriptor);
        else {
          if (this.#choices.size >= 32) throw new Error("STRICT_FIXTURE_CATALOG_LIMIT");
          this.#choices.set(brandString<ContinuationSelectionId>(crypto.randomUUID()), descriptor);
        }
      }
      cursor = page.nextCursor;
      if (page.status === "partial") throw new Error("STRICT_FIXTURE_CATALOG_PARTIAL");
    } while (cursor && ++requests < 32);
    if (cursor) throw new Error("STRICT_FIXTURE_CATALOG_LIMIT");
  }
  async #open(action: Extract<ContinuationAction, { type: "continue" | "new" }>): Promise<void> {
    const selected = action.type === "continue" ? this.#choices.get(action.selectionId) : undefined;
    if (this.#opening) {
      if (selected && selected.reference === this.#openingReference) { await this.#opening; return; }
      const record: ContinuationRegistration = { id: brandString<ContinuationRegistrationId>(crypto.randomUUID()),
        intent: action.type === "new" ? "new" : "continue", status: "registered", attempt: "failed", code: "STRICT_HOST_SESSION_ACTIVE",
        ...(selected ? { reference: selected.reference, nativeSessionId: selected.nativeSessionId, sourceId: selected.sourceId, instanceId: selected.instanceId } : {}) };
      if (this.#records.length >= 32) throw new Error("STRICT_REGISTRATION_LIMIT");
      this.#records.push(record); await this.#save(); return;
    }
    const done = Promise.withResolvers<void>();
    this.#opening = done.promise; this.#openingReference = selected?.reference; this.#cancelRequested = false;
    try { await this.#performOpen(action); }
    finally { this.#opening = undefined; this.#openingReference = undefined; this.#openingRecord = undefined; done.resolve(); }
  }
  async #performOpen(action: Extract<ContinuationAction, { type: "continue" | "new" }>): Promise<void> {
    const selected = action.type === "continue" ? this.#choices.get(action.selectionId) : undefined;
    if (action.type === "continue" && !selected) throw new Error("STRICT_SELECTION_INVALID");
    const existing = selected ? this.#records.find(record => record.reference === selected.reference) : undefined;
    const active = this.#active;
    if (active && !active.retired && active.selected?.reference === selected?.reference && existing?.attempt === "open") {
      await this.#recheck(); return;
    }
    if (this.#records.length >= 32 && !existing) throw new Error("STRICT_REGISTRATION_LIMIT");
    const record: ContinuationRegistration = existing ?? { id: brandString<ContinuationRegistrationId>(crypto.randomUUID()),
      intent: action.type === "new" ? "new" : "continue", status: "registered", attempt: "opening",
      ...(selected ? { reference: selected.reference, nativeSessionId: selected.nativeSessionId,
        instanceId: selected.instanceId, sourceId: selected.sourceId } : {}) };
    if (!existing) this.#records.push(record);
    record.attempt = "opening"; delete record.code; this.#openingRecord = record;
    await this.#save(); // First explicit open registers before revalidation/reservation/startup.
    if (active && !active.drained) { record.attempt = "failed"; record.code = "STRICT_HOST_SESSION_ACTIVE"; await this.#save(); return; }
    if (selected) {
      const description = await this.options.catalog.describe(selected.reference);
      if (description.status !== "verified" || !description.item || description.item.cwd.status !== "known"
        || description.item.cwd.canonical !== this.options.cwd) {
        record.attempt = "failed"; record.code = description.status === "verified" ? "STRICT_CWD_UNAUTHORIZED" : `STRICT_${description.status.toUpperCase()}`;
        await this.#save(); return;
      }
    }
    if (this.#cancelRequested) { record.attempt = "cancelled"; record.code = "STRICT_CANCELLED"; await this.#save(); return; }
    const current: Active = { id: brandString<ContinuationWorkerId>(crypto.randomUUID()), record,
      client: this.options.launch(selected), retired: false, drained: false, started: false, ...(selected ? { selected } : {}) };
    this.#active = current; this.#state = undefined; this.#starts++;
    try {
      const client = await current.client;
      if (current.retired || this.#cancelRequested) {
        record.attempt = "cancelled"; record.code = "STRICT_CANCELLED"; current.retired = true;
        await client.close(); current.drained = true; await this.#save(); return;
      }
      void client.exited.then(() => {
        if (!current.retired && current.record.attempt !== "cancelled") {
          current.record.attempt = "outcome_unknown"; current.record.code = "STRICT_WORKER_EXITED"; void this.#save();
        }
      });
      current.started = true;
      const state = await client.startup.start({ intent: record.intent, expectedCwd: this.options.cwd,
        ...(selected ? { reference: selected.reference } : {}) });
      this.#accept(current, state);
    } catch (error) {
      const code = error instanceof Error && /^(?:STRICT|GENERATION|RPC)_[A-Z_]+$/.test(error.message) ? error.message : "STRICT_OPERATION_UNKNOWN";
      if (record.attempt === "cancelled") { record.code = "STRICT_CANCELLED"; }
      else record.attempt = code.startsWith("RPC_") || code.includes("OUTCOME_UNKNOWN") || code === "STRICT_OPERATION_UNKNOWN"
        ? "outcome_unknown" : code === "STRICT_CANCELLED" ? "cancelled" : "failed";
      if (record.attempt !== "cancelled") record.code = code;
    }
    if (record.attempt === "failed" || record.attempt === "cancelled") {
      current.retired = true;
      try { await (await current.client).close(); current.drained = true; } catch { record.code = "STRICT_WORKER_DRAIN_UNKNOWN"; }
    }
    await this.#save();
  }
  #accept(active: Active, state: StrictStartState): void {
    if (this.#active !== active || active.retired) return;
    if (state.phase === "open" && (!state.binding || state.cwd !== this.options.cwd
      || (active.selected && (state.binding.sourceId !== active.selected.sourceId
        || state.binding.instanceId !== active.selected.instanceId || state.nativeSessionId !== active.selected.nativeSessionId))))
      throw new Error("STRICT_RESULT_IDENTITY");
    this.#state = state;
    const record = active.record;
    record.attempt = state.phase === "open" ? "open" : state.phase === "cancelling" ? "cancelling"
      : state.phase === "cancelled" ? "cancelled" : state.phase === "outcome_unknown" ? "outcome_unknown" : "opening";
    if (state.code) record.code = state.code; else delete record.code;
    if (state.phase === "open" && state.binding) Object.assign(record, { nativeSessionId: state.binding.nativeSessionId,
      sourceId: state.binding.sourceId, instanceId: state.binding.instanceId, reference: state.binding.reference });
  }
  async #recheck(): Promise<void> {
    const active = this.#active;
    if (!active || active.retired || ["cancelled", "failed"].includes(active.record.attempt)) return;
    try { this.#accept(active, await (await active.client).startup.state()); }
    catch { active.record.attempt = "outcome_unknown"; active.record.code = "STRICT_OUTCOME_UNAVAILABLE"; }
    await this.#save();
  }
  async act(action: ContinuationAction): Promise<ContinuationSnapshot> {
    if (action.type === "discover") await this.#discover();
    else if (action.type === "continue" || action.type === "new") await this.#open(action);
    else if (action.type === "recheck") await this.#recheck();
    else if (action.type === "cancel") {
      this.#cancelRequested = true;
      if (this.#openingRecord) { this.#openingRecord.attempt = "cancelling"; this.#openingRecord.code = "STRICT_CANCEL_REQUESTED"; }
      const active = this.#active;
      if (active && !active.retired) {
        try {
          const client = await active.client;
          if (!active.retired && active.started) this.#accept(active, await client.startup.cancel());
        }
        catch { active.record.attempt = "outcome_unknown"; active.record.code = "STRICT_CANCEL_OUTCOME_UNKNOWN"; }
        await this.#save();
      }
    } else if (action.type === "close") await this.close();
    return this.snapshot();
  }
  async close(): Promise<void> {
    this.#cancelRequested = true;
    const active = this.#active;
    if (!active) { await this.#opening; return; }
    if (active.drained) return;
    active.retired = true;
    const drained = await (await active.client).close(); active.drained = true;
    if (drained.forced || drained.code !== 0) { active.record.attempt = "outcome_unknown"; active.record.code = "STRICT_WORKER_DRAIN_UNKNOWN"; }
    if (active.record.attempt === "open") active.record.attempt = "closed";
    await this.#save();
  }
}
