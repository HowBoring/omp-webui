import { expect, test } from "bun:test";
import { checkEmptyOwnershipDispatcher, type ProbeOwnershipClient } from "../../compatibility/omp/fixtures/native-signed-probe-checks";
import * as fs from "node:fs/promises";
import { authenticateProbeLaunch, probeLaunchMembers, probePlatformMembers, sha256 } from "../../compatibility/omp/fixtures/native-signed-probe-launch";

/** External Native SDK fault boundary only. These fakes never construct approval, selection or module owners. */
function client(scopes: readonly unknown[], refusal: unknown): ProbeOwnershipClient {
  return { async listScopes() { return scopes; }, async inspectBroker() { throw refusal; }, close() {} };
}
const missing = () => Object.assign(new Error("missing"), { code: "dispatcher_unavailable" });

test("read-only probe refuses an occupied dispatcher before attempting inspection", async () => {
  await expect(checkEmptyOwnershipDispatcher(() => client([{ kind: "global" }], missing())))
    .rejects.toThrow("PROBE_UNEXPECTED_SCOPE");
});

test("read-only probe requires the authenticated public SDK missing-scope refusal", async () => {
  await expect(checkEmptyOwnershipDispatcher(() => client([], new Error("bad signature"))))
    .rejects.toThrow("bad signature");
});

test("read-only probe detects a scope created by inspection", async () => {
  const clients = [client([], missing()), client([], missing()), client([{}], missing())];
  await expect(checkEmptyOwnershipDispatcher(() => {
    const next = clients.shift(); if (!next) throw new Error("UNEXPECTED_RECONNECT"); return next;
  })).rejects.toThrow("PROBE_UNEXPECTED_SCOPE");
});

test("signed launch provenance rejects changed bootstrap bytes before any Native import", async () => {
  const stage = await fs.mkdtemp("/tmp/native-signed-probe-unit-");
  try {
    for (const name of ["operator", "launch", "launch/worker"]) await fs.mkdir(`${stage}/${name}`, { mode: 0o700 });
    const pin = async (file: string) => { const stat = await fs.lstat(file, { bigint: true });
      return { path: file, device: String(stat.dev), inode: String(stat.ino), sha256: sha256(await fs.readFile(file)) }; };
    await fs.writeFile(`${stage}/launch/worker/cli.js`, "// original bootstrap\n", { mode: 0o600 });
    const inventory = JSON.stringify({ format: "omp-native-signed-probe-launch/1", members: await probeLaunchMembers(`${stage}/launch`),
      platformDependencies: await probePlatformMembers() });
    await fs.writeFile(`${stage}/launch/launch-closure.json`, inventory, { mode: 0o600 });
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const parent = await fs.lstat(`${stage}/operator`, { bigint: true });
    const installation = "a".repeat(64), record = `${stage}/operator/approval.json`;
    const anchor = { version: "omp-execution-approval-anchor/2", installation,
      approvalPublicKey: Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url"),
      approvalRecord: { path: record, parent: { path: `${stage}/operator`, device: String(parent.dev), inode: String(parent.ino) } },
      approvalVersion: "omp-execution-approval/3", recordBytes: 16384 };
    await fs.writeFile(`${stage}/operator/anchor.json`, JSON.stringify(anchor), { mode: 0o600 });
    await fs.writeFile(`${stage}/operator/key.json`, "{}", { mode: 0o600 });
    const payload = JSON.stringify({ version: "omp-execution-approval/3", installation,
      identity: { closure: sha256(inventory), schema: "b".repeat(64) }, releaseRoot: `${stage}/launch/components`,
      entry: { path: `${stage}/launch/bin/omp`, device: "1", inode: "1", sha256: "c".repeat(64) },
      dispatcherReplyPublicKey: "test-distinct-reply-key" });
    const signature = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey,
      new TextEncoder().encode(`omp-execution-release-approval/3\0${payload}`))).toString("base64url");
    await fs.writeFile(record, JSON.stringify({ version: "omp-execution-signed-approval/1", payload, signature }), { mode: 0o600 });
    await fs.writeFile(`${stage}/launch/worker/cli.js`, "// substituted bootstrap\n");
    await expect(authenticateProbeLaunch({ stage, installation, anchor: await pin(`${stage}/operator/anchor.json`),
      key: await pin(`${stage}/operator/key.json`) })).rejects.toThrow("PROBE_LAUNCH_CLOSURE_CHANGED");
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
});
