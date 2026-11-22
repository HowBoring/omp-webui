import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { digest, identifyAsset, manifestSchema } from "./installation.ts";

export interface TrustedAssets {
  identity: string | undefined;
  /** Serve one enrolled asset. `transform` rewrites text/html after verification. */
  response(name: string, transform?: (html: string) => string): Promise<Response>;
  /** Read one enrolled asset after the same verification, for Host-side tables the browser never sees. */
  bytes(name: string): Promise<Uint8Array>;
}

/** Serve only assets in the startup-selected trust manifest; no source or launcher facts reach the browser. */
export async function trustedDiagnosticAssets(manifestPath: string, directory: string, expectedIdentity?: string) {
  return trustedAssets(manifestPath, directory, expectedIdentity, {
    requiredIdentity: false, unverified: "Diagnostic assets unverified; Session admission blocked",
  });
}

/**
 * Product assets require an independently enrolled manifest identity. A self-consistent manifest is not
 * trust: the operator must pin its digest out of band before the Host serves any product byte.
 */
export async function trustedProductAssets(manifestPath: string, directory: string, expectedIdentity: string) {
  return trustedAssets(manifestPath, directory, expectedIdentity, {
    requiredIdentity: true, unverified: "Product assets unverified; Session admission blocked",
  });
}

async function trustedAssets(manifestPath: string, directory: string, expectedIdentity: string | undefined,
  policy: { requiredIdentity: boolean; unverified: string }): Promise<TrustedAssets> {
  try {
    if (policy.requiredIdentity && expectedIdentity === undefined) throw new Error("independent identity required");
    const bytes = await readFile(manifestPath);
    const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    const root = resolve(dirname(manifestPath), "../..");
    const identity = digest(bytes);
    if (expectedIdentity !== undefined && expectedIdentity !== identity) throw new Error("manifest trust differs");
    const entries = new Map(manifest.assets.map(asset => [asset.path, asset]));
    /** Read one enrolled file, re-proving manifest and asset identity on every read. */
    const verified = async (name: string): Promise<Buffer> => {
      if (digest(await readFile(manifestPath)) !== identity) throw new Error("trust changed");
      const path = relative(root, resolve(directory, name));
      const expected = entries.get(path);
      const assetBytes = await readFile(resolve(directory, name));
      if (expected === undefined || expected.kind !== "file" || digest(assetBytes) !== expected.identity
        || JSON.stringify(await identifyAsset(root, path, manifestPath)) !== JSON.stringify(expected)) {
        throw new Error("asset mismatch");
      }
      return assetBytes;
    };
    return {
      identity,
      async bytes(name: string): Promise<Uint8Array> { return verified(name); },
      async response(name: string, transform?: (html: string) => string): Promise<Response> {
        try {
          const assetBytes = await verified(name);
          const html = name.endsWith(".html");
          const body = html && transform !== undefined ? transform(assetBytes.toString("utf8")) : new Uint8Array(assetBytes);
          return new Response(body, { headers: {
            "content-type": contentType(name), "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:",
          } });
        } catch { return new Response(policy.unverified, { status: 503 }); }
      },
    };
  } catch {
    return { identity: undefined, async response(): Promise<Response> {
      return new Response(policy.unverified, { status: 503 });
    }, async bytes(): Promise<Uint8Array> { throw new Error(policy.unverified); } };
  }
}

const contentTypes: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", webmanifest: "application/manifest+json",
  map: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
  otf: "font/otf", txt: "text/plain; charset=utf-8", wasm: "application/wasm",
};

/** Media type by filename extension; unknown files are opaque bytes. */
function contentType(name: string): string {
  return contentTypes[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}
