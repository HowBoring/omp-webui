import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import Schema from "@deepseek-ai/schemastery";
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";
import { Remote, RemoteError, TypertRemoteService, type PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsNamespace,
} from "@deepseek-ai/dsh-settings/types";
import { z } from "zod";

/** Existing DSH DTOs, restricted to presentation preferences; never mount the stock credentials owner. */
export const preferencesHostContribution: TypertContribution = {
  package: "@omp-webui/web-preferences", face: "host", schemas: [], model: { services: [], events: [], objects: [] },
  invocations: TYPERT_REMOTE.descriptors.filter(value => value.namespace === "settings"
    && (value.method === "describe" || value.method === "mutate")),
};
type Namespace = "ui-theme" | "locale";
interface Section { revision: number; preference?: string }
const localePattern = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const themeSchema = Schema.object({ preference: Schema.union(["light", "dark", "system"]).default("system") });
const localeSchema = Schema.object({ preference: Schema.string().pattern(localePattern).required(false) });
const namespace = (ns: string): ns is Namespace => ns === "ui-theme" || ns === "locale";

/**
 * Restricted Host-owned WebUI settings owner. State lasts for this service lifetime;
 * restart persistence and product registration are deliberately not provided by this source slice.
 * Authorization must check the current Host browser credential, not just the DSH owner principal.
 */
export class WebPreferences extends TypertRemoteService {
  private readonly sections: Record<Namespace, Section> = {
    "ui-theme": { revision: 0 }, locale: { revision: 0 },
  };
  constructor(ctx: Context, private readonly authorize: (peer: PeerScope) => void) {
    super(ctx, "settingsController", { namespace: "settings" });
  }
  private assertCurrentAuthority(): void {
    const invocation = this.ctx.invocation;
    if (!invocation || invocation.signal.aborted || invocation.peer.signal.aborted) {
      throw new RemoteError("gateway/bad-request", "WebUI preference authority is unavailable.", {});
    }
    try { this.authorize(invocation.peer); }
    catch { throw new RemoteError("gateway/bad-request", "WebUI preference authority is unavailable.", {}); }
  }
  private view(ns: Namespace): SettingsNamespaceView {
    const section = this.sections[ns];
    const value = section.preference === undefined
      ? (ns === "ui-theme" ? { preference: "system" } : {}) : { preference: section.preference };
    const schema = z.json().parse(JSON.parse(JSON.stringify(ns === "ui-theme" ? themeSchema : localeSchema)));
    return { ns, autoGenerate: false, schema,
      value, user: section.preference === undefined ? {} : { preference: section.preference },
      applies: "live", secrets: [], revision: section.revision };
  }
  @Remote("describe") describe(): SettingsDescribeValue {
    this.assertCurrentAuthority();
    return { writable: true, hasDocument: false, namespaces: [this.view("ui-theme"), this.view("locale")] };
  }
  /** One preference per CAS write. No generic profile patch, config document or native call exists here. */
  @Remote("mutate") mutate(
    ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined,
  ): SettingsNamespaceView {
    this.assertCurrentAuthority();
    if (!namespace(ns) || !Number.isSafeInteger(expectedRevision)
      || expectedRevision === undefined || expectedRevision < 0) {
      throw new RemoteError("gateway/bad-request",
        "A known WebUI namespace and its current revision are required.", {});
    }
    const section = this.sections[ns];
    if (section.revision !== expectedRevision) {
      throw new RemoteError("settings/conflict", "WebUI preference changed. Read it again before editing.",
        { ns, expected: expectedRevision, actual: section.revision });
    }
    const op = ops[0];
    if (ops.length !== 1 || !op || op.path.length !== 1 || op.path[0] !== "preference"
      || (op.op !== "set" && op.op !== "unset")) this.reject(ns);
    if (op.op === "set" && (typeof op.value !== "string" || op.value.length > 128
      || (ns === "ui-theme" ? !["light", "dark", "system"].includes(op.value) : !localePattern.test(op.value)))) {
      this.reject(ns);
    }
    // Synchronous admission and commit: invalidation cannot interleave after this final authority check.
    this.assertCurrentAuthority();
    if (op.op === "unset") delete section.preference;
    else section.preference = String(op.value);
    section.revision++;
    this.ctx.emit("settings/document-updated", brandString<SettingsNamespace>(ns), section.revision);
    return this.view(ns);
  }
  private reject(ns: Namespace): never {
    throw new RemoteError("settings/rejected", "Only a supported WebUI preference edit is available.", { ns });
  }
}
