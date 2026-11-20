import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { digest, identifyAsset, manifestSchema } from "./installation.ts";

export interface TrustedAssets {
  identity: string | undefined;
  response(name: "index.html" | "client.js"): Promise<Response>;
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
    return {
      identity,
      async response(name: "index.html" | "client.js"): Promise<Response> {
        try {
          if (digest(await readFile(manifestPath)) !== identity) throw new Error("trust changed");
          const path = relative(root, resolve(directory, name));
          const expected = entries.get(path);
          const assetBytes = await readFile(resolve(directory, name));
          if (expected === undefined || expected.kind !== "file" || digest(assetBytes) !== expected.identity
            || JSON.stringify(await identifyAsset(root, path, manifestPath)) !== JSON.stringify(expected)) {
            throw new Error("asset mismatch");
          }
          return new Response(new Uint8Array(assetBytes), { headers: {
            "content-type": name === "index.html" ? "text/html" : "text/javascript", "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'",
          } });
        } catch { return new Response(policy.unverified, { status: 503 }); }
      },
    };
  } catch {
    return { identity: undefined, async response(): Promise<Response> {
      return new Response(policy.unverified, { status: 503 });
    } };
  }
}
