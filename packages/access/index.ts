import { AccessStore, equal } from "./store.ts";
import { randomBytes } from "node:crypto";
import type { Credential } from "./store.ts";
import { configuredOrigin, failure, trust } from "./trust.ts";
import type { AdmissionKind } from "./trust.ts";

export type { AdmissionKind } from "./trust.ts";
/** Opaque current browser identity. Retaining it never bypasses revalidation or resource rights. */
export interface BrowserAccess { readonly credentialId: string; readonly expiresAt: number }
export interface BrowserAccessOptions {
  dataDir: string;
  /** Exact listener origin, selected locally. HTTPS is allowed only with an actual TLS listener. */
  origin: string;
  now?: () => number;
}

export function openBrowserAccess(options: BrowserAccessOptions) { return new BrowserAuthority(options); }

export class BrowserAuthority {
  private readonly origin: URL;
  private readonly store: AccessStore;
  private readonly now: () => number;
  private readonly identities = new WeakMap<BrowserAccess, Credential>();
  private unavailable = false;
  private revoking = false;
  private readonly revocationListeners = new Set<() => void>();
  private readonly peers = new Set<{ identity: BrowserAccess; invalidate: () => void }>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(options: BrowserAccessOptions) {
    this.origin = configuredOrigin(options.origin);
    this.store = new AccessStore(options.dataDir, options.origin);
    this.now = options.now ?? Date.now;
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref();
  }

  /** Trusted local operator only: never expose this through HTTP, diagnostics or generic logs. */
  bootstrapLink() { return `${this.origin.origin}/?bootstrap=${this.store.bootstrap()}`; }
  /** Stable non-secret namespace for this origin + canonical data directory + material generation. */
  get hostId() { return this.store.identity(); }

  /**
   * `csrf` is opt-out only for a same-origin raw-byte carrier whose stock browser worker cannot
   * attach the header: the exact Origin, `sec-fetch-site`, and a non-form content type already
   * exclude cross-site writes. Every JSON/form write keeps the token check.
   */
  admit(request: Request, kind: AdmissionKind, csrf = true): BrowserAccess | Response {
    if (this.unavailable || this.revoking) return failure("ACCESS_STATE_UNAVAILABLE", 503);
    try { return this.admitCurrent(request, kind, csrf); }
    catch { return failure("ACCESS_STATE_UNAVAILABLE", 503); }
  }

  private admitCurrent(request: Request, kind: AdmissionKind, csrf: boolean): BrowserAccess | Response {
    const denied = trust(request, this.origin, kind);
    if (denied) return denied;
    const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
    const matches = cookies.filter((part) => part.startsWith("omp_browser="));
    const token = matches.length === 1 ? matches[0]!.slice("omp_browser=".length) : "";
    const credential = /^[A-Za-z0-9_-]{43}$/.test(token) ? this.store.lookup(token, this.now()) : null;
    if (!credential) return failure("AUTH_REQUIRED", 401);
    if (kind === "write" && csrf && !equal(request.headers.get("x-omp-csrf") ?? "", this.store.csrf(credential))) {
      return failure("CSRF_REQUIRED", 403);
    }
    const identity = Object.freeze({ credentialId: credential.id, expiresAt: credential.expiresAt });
    this.identities.set(identity, credential);
    return identity;
  }

  revalidate(identity: BrowserAccess): boolean {
    if (this.unavailable || this.revoking) return false;
    const credential = this.identities.get(identity);
    try { return !!credential && !!this.store.current(credential, this.now()); }
    catch { return false; }
  }

  /** Revalidate the opaque Peer admission and its credential's current CSRF proof. */
  revalidateWrite(identity: BrowserAccess, csrf: string): boolean {
    if (this.unavailable || this.revoking) return false;
    const credential = this.identities.get(identity);
    try {
      return !!credential && !!this.store.current(credential, this.now()) && equal(csrf, this.store.csrf(credential));
    } catch { return false; }
  }

  /** Use for each live stream/Peer; revalidate again on every logical open, reply and publication. */
  attachPeer(identity: BrowserAccess, invalidate: () => void): () => void {
    if (!this.revalidate(identity)) { invalidate(); return () => {}; }
    const peer = { identity, invalidate };
    this.peers.add(peer);
    return () => { this.peers.delete(peer); };
  }

  private sweep() {
    for (const peer of this.peers) {
      if (this.revalidate(peer.identity)) continue;
      this.peers.delete(peer);
      try { peer.invalidate(); } catch { /* A failing peer cannot prevent other peers from closing. */ }
    }
  }

  async handle(request: Request): Promise<Response | null> {
    try { return this.route(request); }
    catch { return failure("ACCESS_STATE_UNAVAILABLE", 503); }
  }

  private route(request: Request): Response | null {
    const denied = trust(request, this.origin, ["GET", "HEAD"].includes(request.method) ? "read" : "write");
    if (denied) return denied;
    const url = new URL(request.url);
    if (url.pathname === "/" && url.searchParams.has("bootstrap")) return this.exchange(request, url);
    if (url.pathname === "/auth/status") return this.status(request);
    if (url.pathname === "/auth/logout") return this.logout(request);
    if (url.pathname === "/" && request.method === "GET") {
      const nonce = randomBytes(16).toString("base64url");
      const policy = pageHeaders["content-security-policy"].replace("nonce-access", `nonce-${nonce}`);
      return new Response(page.replace('nonce="access"', `nonce="${nonce}"`), { headers: {
        ...pageHeaders, "content-security-policy": policy,
      } });
    }
    return null;
  }

  private exchange(request: Request, url: URL): Response {
    const denied = trust(request, this.origin, "read");
    if (denied) return denied;
    if (request.method !== "GET" || [...url.searchParams.keys()].length !== 1) return failure("INVALID_BOOTSTRAP", 400);
    const token = url.searchParams.get("bootstrap") ?? "";
    const credential = /^[A-Za-z0-9_-]{43}$/.test(token) ? this.store.exchange(token, this.now()) : null;
    if (!credential) return failure("INVALID_BOOTSTRAP", 401);
    return new Response(null, { status: 303, headers: {
      ...pageHeaders, location: "/", "set-cookie": this.cookie(credential.token, credential.expiresAt),
    } });
  }

  private status(request: Request): Response {
    const identity = this.admit(request, "read");
    if (identity instanceof Response) return identity;
    const credential = this.identities.get(identity)!;
    return Response.json({ authenticated: true, hostId: this.hostId, expiresAt: identity.expiresAt,
      csrf: this.store.csrf(credential) },
      { headers: { "cache-control": "no-store" } });
  }

  private logout(request: Request): Response {
    if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", 405);
    const identity = this.admit(request, "write");
    if (identity instanceof Response) return identity;
    this.store.revoke(this.identities.get(identity)!);
    this.sweep();
    return new Response(null, { status: 204, headers: {
      "cache-control": "no-store", "set-cookie": this.cookie("", 0),
    } });
  }

  private cookie(token: string, expiresAt: number) {
    return `omp_browser=${token}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
      + (this.origin.protocol === "https:" ? "; Secure" : "");
  }

  /** Trusted lifecycle observer. Called synchronously so supervised admission closes before asynchronous draining. */
  onRevokeAll(listener: () => void): () => void {
    this.revocationListeners.add(listener); return () => { this.revocationListeners.delete(listener); };
  }

  /** Trusted local control only. No secret is returned and no generic browser route invokes this operation. */
  revokeAll(): void {
    this.revoking = true;
    let listenerFailed = false;
    try {
      for (const listener of this.revocationListeners) { try { listener(); } catch { listenerFailed = true; } }
      this.store.revokeAll();
      if (listenerFailed) throw new Error("ACCESS_REVOCATION_FAILED");
    } catch (error) { this.unavailable = true; throw error; }
    finally {
      for (const peer of this.peers) { try { peer.invalidate(); } catch {} }
      this.peers.clear(); this.revoking = false;
    }
  }

  close() {
    this.revocationListeners.clear();
    clearInterval(this.timer);
    for (const peer of this.peers) { try { peer.invalidate(); } catch { /* close all */ } }
    this.peers.clear();
    this.store.close();
  }
}

const pageHeaders = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; script-src 'nonce-access'; connect-src 'self'; "
    + "base-uri 'none'; frame-ancestors 'none'",
};
const page = `<!doctype html><meta charset="utf-8"><title>OMP WebUI access</title>
<h1>OMP WebUI</h1><p id="status">Checking browser access…</p><button id="logout" hidden>Log out</button>
<script nonce="access">
let csrf;
async function status() {
  const response = await fetch('/auth/status', {cache:'no-store'});
  const active = response.ok;
  if (active) csrf = (await response.json()).csrf;
  document.getElementById('status').textContent = active
    ? 'Browser authorized. Session access awaits compatibility and resource admission.'
    : 'Browser authorization required. Open a fresh local bootstrap link.';
  document.getElementById('logout').hidden = !active;
}
document.getElementById('logout').onclick = async () => {
  await fetch('/auth/logout', {method:'POST', headers:{'x-omp-csrf':csrf}}); await status();
};
document.addEventListener('visibilitychange', status);
setInterval(status, 2000); status();
</script>`;
