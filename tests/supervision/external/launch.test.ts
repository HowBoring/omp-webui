import { expect, test } from "bun:test";
import { externalBrokerLaunch } from "../../../packages/supervision/external-launch.ts";

test("dispatcher construction selects only the separately approved protector and canonical broker hints", () => {
  expect(externalBrokerLaunch({ releaseRoot: "/approved/release", generation: "b".repeat(64),
    scope: { directory: "/synthetic/project", kind: "project" } })).toEqual({
    kind: "broker-tree", argv: ["/approved/release/bin/omp-external-protector", "b".repeat(64)],
    environmentHints: { OMP_EXECUTION_BROKER_GENERATION: "b".repeat(64),
      OMP_EXECUTION_BROKER_SCOPE: '{"kind":"project","directory":"/synthetic/project"}' },
  });
});

test("external construction rejects noncanonical roots and scopes before returning any launch material", () => {
  expect(() => externalBrokerLaunch({ releaseRoot: "/approved/../other", generation: "b".repeat(64),
    scope: { kind: "project", directory: "/synthetic/project" } })).toThrow("EXTERNAL_LAUNCH_UNSUPPORTED");
  expect(() => externalBrokerLaunch({ releaseRoot: "/approved/release", generation: "b".repeat(64),
    scope: { kind: "project", directory: "/synthetic/../private" } })).toThrow("EXTERNAL_LAUNCH_UNSUPPORTED");
});
