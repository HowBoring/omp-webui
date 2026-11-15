import { describe, expect, test } from "bun:test";
import { createFetchHandler } from "../../apps/host/src/http.ts";

describe("Host scaffold HTTP handler", () => {
  test("exposes a health endpoint", async () => {
    const response = await createFetchHandler()(
      new Request("http://localhost/healthz"),
    );

    expect(response.status).toBe(200);
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
});
