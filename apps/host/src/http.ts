export interface FetchHandler {
  (request: Request): Response | Promise<Response>;
}

export function createFetchHandler(): FetchHandler {
  return (request) => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({
        service: "omp-webui-host",
        status: "ok",
        stage: "scaffold",
      });
    }

    if (url.pathname.startsWith("/api/")) {
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
