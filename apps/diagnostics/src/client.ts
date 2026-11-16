import { Context } from "@deepseek-ai/cordis";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import { apply as connection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { diagnosticReportSchema, diagnosticsContribution } from "../../../packages/contracts/diagnostics.ts";
import type { DiagnosticReport } from "../../../packages/contracts/diagnostics.ts";

declare module "@deepseek-ai/cordis" {
  interface Context { connection: ConnectionHandle }
}

const output = document.querySelector<HTMLElement>("#diagnostic");
if (output === null) throw new Error("Missing diagnostic mount");
const root = output;
const ctx = new Context();
let disposed = false;
let revision = 0;

function blocked(code: string): void {
  root.dataset.status = "blocked";
  root.replaceChildren(text("h2", "Preflight blocked"), text("p", "Session admission: blocked"), text("p", code));
}

function text(tag: string, value: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

function render(report: DiagnosticReport): void {
  root.dataset.status = report.status;
  const title = report.status === "verified-blocked" ? "Build verified; Session access blocked" : "Preflight blocked";
  const rows = [text("h2", title), text("p", "Session admission: blocked"), text("p", report.code)];
  if (report.identity !== undefined) {
    const details = document.createElement("dl");
    for (const [name, value] of Object.entries(report.identity)) {
      const display = typeof value === "string" ? value : `${value.name} ${value.version} ${value.platform} ${value.arch}`;
      details.append(text("dt", name), text("dd", display));
    }
    rows.push(details);
  }
  rows.push(text("h3", "Missing capabilities"));
  const missing = document.createElement("ul");
  for (const capability of report.missingCapabilities) missing.append(text("li", capability));
  rows.push(missing);
  root.replaceChildren(...rows);
}

async function preflight(): Promise<void> {
  const current = ++revision;
  blocked("preflight_pending");
  try {
    const result = await ctx.remote.ompDiagnostics.preflight();
    if (disposed || current !== revision) return;
    if (!result.ok) return blocked("remote_preflight_failed");
    const report = diagnosticReportSchema.safeParse(result.value);
    if (!report.success) return blocked("invalid_diagnostic_report");
    render(report.data);
  } catch {
    if (!disposed && current === revision) blocked("diagnostic_boot_failed");
  }
}

async function boot(): Promise<void> {
  connection(ctx);
  registry(ctx);
  gateway(ctx);
  await ctx.remote.$mount(diagnosticsContribution);
  const refresh = (): void => {
    if (disposed) return;
    if (ctx.connection.generation.getSnapshot() === undefined) {
      ++revision;
      blocked("connection_unavailable");
    } else {
      void preflight();
    }
  };
  const unsubscribe = ctx.connection.generation.subscribe(refresh);
  ctx.effect(() => unsubscribe);
  refresh();
}

window.addEventListener("pagehide", () => {
  disposed = true;
  ++revision;
  blocked("diagnostic_page_suspended");
  void ctx.fiber.dispose();
}, { once: true });
window.addEventListener("pageshow", event => {
  if (event.persisted && disposed) window.location.reload();
});
void boot().catch(() => blocked("diagnostic_boot_failed"));
