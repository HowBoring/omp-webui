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
/**
 * The stock theme client reads a complete section on boot; a partial section crashes its
 * settings subscriber (normalizeFontFamily(undefined)). These defaults and ranges mirror
 * @deepseek-ai/dsh-client-ui-theme ThemeSettings.
 */
const THEME_DEFAULTS = Object.freeze({
  preference: "system", fontSize: 14, codeFontSize: 11, terminalFontSize: 13,
  textFontFamily: "", codeFontFamily: "", terminalFontFamily: "",
});
type ThemeField = keyof typeof THEME_DEFAULTS;
const THEME_FONT_SIZES = { fontSize: [10, 22], codeFontSize: [10, 16], terminalFontSize: [10, 20] } as const;
const isThemeField = (value: string): value is ThemeField => value in THEME_DEFAULTS;
const isFontSize = (value: string): value is keyof typeof THEME_FONT_SIZES => value in THEME_FONT_SIZES;
const FONT_FAMILY_FIELDS = ["textFontFamily", "codeFontFamily", "terminalFontFamily"] as const;
const FONT_FAMILY_FIELD = new Set<string>(FONT_FAMILY_FIELDS);
interface Section { revision: number; values: Record<string, string | number> }
const localePattern = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const themeSchema = Schema.object({
  preference: Schema.union(["light", "dark", "system"]).default("system"),
  fontSize: Schema.number().min(10).max(22).step(1).default(14),
  codeFontSize: Schema.number().min(10).max(16).step(1).default(11),
  terminalFontSize: Schema.number().min(10).max(20).step(1).default(13),
  textFontFamily: Schema.string().default(""),
  codeFontFamily: Schema.string().default(""),
  terminalFontFamily: Schema.string().default(""),
});
const localeSchema = Schema.object({ preference: Schema.string().pattern(localePattern).required(false) });
const namespace = (ns: string): ns is Namespace => ns === "ui-theme" || ns === "locale";

/**
 * Restricted Host-owned WebUI settings owner. State lasts for this service lifetime;
 * restart persistence and product registration are deliberately not provided by this source slice.
 * Authorization must check the current Host browser credential, not just the DSH owner principal.
 */
export class WebPreferences extends TypertRemoteService {
  private readonly sections: Record<Namespace, Section> = {
    "ui-theme": { revision: 0, values: {} }, locale: { revision: 0, values: {} },
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
  /** Effective section: theme merges stored fields over the stock defaults; locale has no defaults. */
  private effective(ns: Namespace): Record<string, string | number> {
    return ns === "ui-theme" ? { ...THEME_DEFAULTS, ...this.sections[ns].values } : { ...this.sections[ns].values };
  }
  private view(ns: Namespace): SettingsNamespaceView {
    const section = this.sections[ns];
    const schema = z.json().parse(JSON.parse(JSON.stringify(ns === "ui-theme" ? themeSchema : localeSchema)));
    return { ns, autoGenerate: false, schema, value: this.effective(ns), user: { ...section.values },
      applies: "live", secrets: [], revision: section.revision };
  }
  @Remote("describe") describe(): SettingsDescribeValue {
    this.assertCurrentAuthority();
    return { writable: true, hasDocument: false, namespaces: [this.view("ui-theme"), this.view("locale")] };
  }
  /** One field per CAS write. No generic profile patch, config document or native call exists here. */
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
    if (ops.length === 0 || ops.length > 16) this.reject(ns);
    const committed: [string, string | number | undefined][] = [];
    for (const op of ops) {
      if ((op.op !== "set" && op.op !== "unset") || op.path.length !== 1) this.reject(ns);
      const field = op.path[0]!;
      if (ns === "ui-theme") {
        if (!isThemeField(field)) this.reject(ns);
        if (op.op === "unset") { committed.push([field, undefined]); continue; }
        if (field === "preference") {
          if (typeof op.value !== "string" || !["light", "dark", "system"].includes(op.value)) this.reject(ns);
          committed.push([field, op.value]);
        } else if (isFontSize(field)) {
          const [min, max] = THEME_FONT_SIZES[field];
          if (typeof op.value !== "number" || !Number.isInteger(op.value) || op.value < min || op.value > max) this.reject(ns);
          committed.push([field, op.value]);
        } else {
          if (!FONT_FAMILY_FIELD.has(field) || typeof op.value !== "string" || op.value.length > 512) this.reject(ns);
          committed.push([field, op.value]);
        }
      } else {
        if (field !== "preference") this.reject(ns);
        if (op.op === "unset") { committed.push([field, undefined]); continue; }
        if (typeof op.value !== "string" || op.value.length > 128 || !localePattern.test(op.value)) this.reject(ns);
        committed.push([field, op.value]);
      }
    }
    // Synchronous admission and commit: invalidation cannot interleave after this final authority check.
    this.assertCurrentAuthority();
    for (const [field, value] of committed) {
      if (value === undefined) delete section.values[field];
      else section.values[field] = value;
    }
    section.revision++;
    this.ctx.emit("settings/document-updated", brandString<SettingsNamespace>(ns), section.revision);
    return this.view(ns);
  }
  private reject(ns: Namespace): never {
    throw new RemoteError("settings/rejected", "Only a supported WebUI preference edit is available.", { ns });
  }
}
