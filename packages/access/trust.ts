export type AdmissionKind = "read" | "write" | "websocket";

export function configuredOrigin(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== value) {
    throw new Error("Access origin must be an exact loopback HTTP(S) origin");
  }
  return url;
}

export function failure(code: string, status: number): Response {
  return Response.json({ error: { code } }, { status, headers: { "cache-control": "no-store" } });
}

/** Must run before cookie lookup, body consumption, parameter parsing or resource lookup. */
export function trust(request: Request, origin: URL, kind: AdmissionKind): Response | null {
  let url: URL;
  try { url = new URL(request.url); }
  catch { return failure("INVALID_HOST", 403); }
  const host = request.headers.get("host");
  if (host === null || !validHost(host, origin) || url.origin !== origin.origin) return failure("INVALID_HOST", 403);
  if ([...request.headers.keys()].some((key) => key === "forwarded" || key.startsWith("x-forwarded-"))) {
    return failure("UNTRUSTED_PROXY", 403);
  }
  const source = request.headers.get("origin");
  if ((source !== null && source !== origin.origin) || (kind !== "read" && source === null)) {
    return failure("INVALID_ORIGIN", 403);
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && !(kind === "read" && site === "none")) {
    return failure("CROSS_SITE", 403);
  }
  if (kind === "read" && !["GET", "HEAD"].includes(request.method)) return failure("METHOD_NOT_ALLOWED", 405);
  if (kind === "websocket"
    && (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket")) {
    return failure("INVALID_UPGRADE", 400);
  }
  return null;
}

function validHost(host: string, origin: URL) {
  if (!host || /[\s/@?#\\,%]/.test(host)) return false;
  try {
    const parsed = new URL(`${origin.protocol}//${host}`);
    return host.toLowerCase() === origin.host && parsed.host === origin.host
      && parsed.pathname === "/" && !parsed.username && !parsed.password;
  } catch { return false; }
}
