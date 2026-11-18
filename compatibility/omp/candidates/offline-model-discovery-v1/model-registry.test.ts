import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadExactSource } from "./load-exact-source.ts";

interface NetworkGuard {
  denied(): number;
  dispatched(): number;
}

const source45Test = process.env.OMP_TEST_OFFLINE_REGISTRY === "1" ? test : test.skip;
source45Test("offline background and extension discovery settle without fetching a cold catalog", async () => {
  const root = process.env.OMP_SOURCE45_ROOT;
  const guard: NetworkGuard | undefined = Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"));
  if (!root || !path.isAbsolute(root) || Bun.version !== "1.4.4" ||
      process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH !== "0" || process.env.NODE_DISABLE_COMPILE_CACHE !== "1" ||
      !guard || typeof guard.denied !== "function" || typeof guard.dispatched !== "function") {
    throw Error("PINNED_GUARDED_SOURCE45_REQUIRED");
  }
  expect([guard.denied(), guard.dispatched()]).toEqual([0, 0]);
  const source = path.join(root, "vendor/omp/packages/coding-agent/src");
  const modelRegistry = `${source}/config/model-registry.ts`;
  expect(Bun.CryptoHasher.hash("sha256", fs.readFileSync(modelRegistry), "hex"))
    .toBe("c33502eef8a0931889bdaab2a28da23c64b531b1241d4fbcf816a0d507d434f7");
  if (process.env.OMP_TEST_OFFLINE_OVERLAY === "1") {
    const patch = Bun.spawnSync([
      "/usr/bin/patch", "--batch", "--forward", "--fuzz=0", "--output=-", modelRegistry,
      path.join(import.meta.dir, "model-registry-offline.patch"),
    ], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(patch.exitCode).toBe(0);
    expect(Bun.CryptoHasher.hash("sha256", patch.stdout, "hex"))
      .toBe("4170d9c10d12626e0bc2833282f120529b66a6b5ee5ed129309723baaa4327f5");
    loadExactSource(modelRegistry, patch.stdout.toString(), () => {});
  }
  const { ModelRegistry } = await import(modelRegistry);
  const { cfgOffline } = await import(`${source}/config/auxiliary-model-policy.ts`);
  const { Settings } = await import(`${source}/config/settings.ts`);
  const { AuthStorage } = await import(`${source}/session/auth-storage.ts`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "omp-offline-registry-test-"));
  const auth = await AuthStorage.create(":memory:");
  try {
    const settings = Settings.isolated();
    cfgOffline.override(settings, true);
    const denied = Error("synthetic discovery unavailable");
    let extensionAttempts = 0;
    let builtinAttempts = 0;
    const registry = new ModelRegistry(auth, path.join(profile, "models.yml"), {
      settings,
      fetch: async () => {
        builtinAttempts++;
        throw denied;
      },
    });
    registry.registerProvider("synthetic-offline-registry-test", {
      baseUrl: "https://unreachable.invalid/v1",
      apiKey: "synthetic-unused",
      api: "openai-completions",
      fetchDynamicModels: async () => {
        extensionAttempts++;
        await fetch("https://unreachable.invalid/v1/models");
        throw Error("synthetic discovery unexpectedly reached the network");
      },
    }, "ext://synthetic-offline-registry-test");

    await registry.refreshRuntimeProviders();
    const settled = registry.awaitInitialBackgroundRefresh();
    registry.refreshInBackground();
    await settled;
    expect({ extensionAttempts, builtinAttempts, guardDenials: guard.denied(), dispatched: guard.dispatched() })
      .toEqual({ extensionAttempts: 0, builtinAttempts: 0, guardDenials: 0, dispatched: 0 });
    expect(registry.isBackgroundRefreshPending()).toBe(false);

    await registry.refreshRuntimeProviders("online");
    expect([extensionAttempts, guard.denied(), guard.dispatched()]).toEqual([1, 1, 0]);
    cfgOffline.clearOverride(settings);
    await registry.refreshRuntimeProviders();
    expect([extensionAttempts, guard.denied(), guard.dispatched()]).toEqual([2, 2, 0]);
  } finally {
    auth.close();
    fs.rmSync(profile, { recursive: true });
  }
});
