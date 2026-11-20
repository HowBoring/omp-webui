import type { BrowserAuthority } from "../../../packages/access/index.ts";

export interface FetchHandler {
  (request: Request): Response | Promise<Response>;
}

export function createFetchHandler(access?: BrowserAuthority): FetchHandler {
  return async (request) => {
    const accessResponse = await access?.handle(request);
    if (accessResponse) return accessResponse;
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({
        service: "omp-webui-host",
        status: "ok",
        stage: "scaffold",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      if (access) {
        const admitted = access.admit(request, ["GET", "HEAD"].includes(request.method) ? "read" : "write");
        if (admitted instanceof Response) return admitted;
        return Response.json({ error: { code: "PRIVATE_CAPABILITY_GATE_CLOSED" } }, {
          status: 503, headers: { "cache-control": "no-store" },
        });
      }
      return new Response("The DSH Remote Gateway is not implemented yet.\n", {
        status: 501,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("OMP WebUI Host scaffold. See /healthz.\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  };
}
