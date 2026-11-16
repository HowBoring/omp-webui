import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { digest, identifyAsset, manifestSchema } from "./installation.ts";

/** Serve only assets in the startup-selected trust manifest; no source or launcher facts reach the browser. */
export async function trustedDiagnosticAssets(manifestPath: string, directory: string, expectedIdentity?: string) {
  try {
    const bytes = await readFile(manifestPath);
    if (expectedIdentity !== undefined && digest(bytes) !== expectedIdentity) throw new Error("trust changed");
    const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    const root = resolve(dirname(manifestPath), "../..");
    const identity = digest(bytes);
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
        } catch { return new Response("Diagnostic assets unverified; Session admission blocked", { status: 503 }); }
      },
    };
  } catch {
    return { identity: undefined, async response(): Promise<Response> {
      return new Response("Diagnostic assets unverified; Session admission blocked", { status: 503 });
    } };
  }
}
