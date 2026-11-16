import { expect, test } from "bun:test";
import { inspectDeliveryGate } from "../../packages/delivery/gate.ts";

test("no operator-selected actual global entry remains explicitly blocked without PATH discovery or execution", async () => {
  expect(await inspectDeliveryGate()).toEqual({ status: "blocked", sessionAdmission: "blocked",
    code: "GLOBAL_TARGET_NOT_SELECTED", missingEvidence: expect.arrayContaining([
      "actual-global-target", "final-native-dsh-combination", "native-tui-upgrade-current-data-rollback",
      "worker-private-and-shared-service-maintenance-lifetimes",
    ]) });
});

test("operator inspection command emits a sanitized BLOCKED result when the actual global target is absent", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/inspect-delivery.ts"], {
    env: {}, stdout: "pipe", stderr: "pipe",
  });
  const output: unknown = JSON.parse(await new Response(child.stdout).text());
  expect(await child.exited).toBe(2);
  expect(output).toEqual(expect.objectContaining({ code: "GLOBAL_TARGET_NOT_SELECTED", sessionAdmission: "blocked" }));
  expect(await new Response(child.stderr).text()).toBe("");
});
