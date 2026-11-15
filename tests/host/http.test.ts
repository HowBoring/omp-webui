import { describe, expect, test } from "bun:test";
import { createFetchHandler } from "../../apps/host/src/http.ts";

describe("Host scaffold HTTP handler", () => {
  test("exposes a health endpoint", async () => {
    const response = await createFetchHandler()(
      new Request("http://localhost/healthz"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      service: "omp-webui-host",
      status: "ok",
      stage: "scaffold",
    });
  });

  test("does not pretend the DSH API is implemented", async () => {
    const response = await createFetchHandler()(
      new Request("http://localhost/api/session/list", { method: "POST" }),
    );

    expect(response.status).toBe(501);
  });

  test.each(["/api/remote.mux", "/api/unknown"])(
    "keeps the unimplemented API path %s unavailable",
    async (path) => {
      const response = await createFetchHandler()(new Request(`http://localhost${path}`));

      expect(response.status).toBe(501);
    },
  );

  test.each(["/", "/api", "/missing", "/healthz/", "/.env"])(
    "returns 404 for the non-API path %s",
    async (path) => {
      const response = await createFetchHandler()(new Request(`http://localhost${path}`));

      expect(response.status).toBe(404);
    },
  );

  test("does not expose health through a mutation request", async () => {
    const response = await createFetchHandler()(
      new Request("http://localhost/healthz", { method: "POST" }),
    );

    expect(response.status).toBe(404);
  });

  test("serves a real loopback request and releases its listener", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: createFetchHandler(),
    });

    try {
      expect(server.hostname).toBe("127.0.0.1");
      const response = await fetch(new URL("/healthz", server.url));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: "omp-webui-host",
        status: "ok",
        stage: "scaffold",
      });
    } finally {
      await server.stop(true);
    }
  });
});
