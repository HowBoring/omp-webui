import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const guard: unknown = Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"));
assert.ok(guard && typeof guard === "object" && "denied" in guard && typeof guard.denied === "function",
  "preload the existing no-provider guard");
const donor = process.argv[2];
assert.ok(donor, "pass the read-only Source38 Native checkout");
assert.equal(process.platform, "linux");

const source = "packages/coding-agent/src/utils/file-new-publication.ts";
const preimage = fs.readFileSync(join(donor, source));
assert.equal(createHash("sha256").update(preimage).digest("hex"),
  "a5f97187937433a477974231737dca931b58f959e6d9ed3707e4afd907cbcbf7");

const scratch = fs.mkdtempSync(join(tmpdir(), "omp-branch-publication-"));
try {
  const patchedSource = join(scratch, source);
  fs.mkdirSync(dirname(patchedSource), { recursive: true });
  fs.writeFileSync(patchedSource, preimage);
  const patch = join(import.meta.dir, "native-branch-publication.patch");
  const apply = Bun.spawnSync(["git", "apply", "--", patch], { cwd: scratch });
  assert.equal(apply.exitCode, 0, apply.stderr.toString());
  const { publishNewFile, publishDurableNewFile } = await import(patchedSource);
  const target = join(scratch, "sessions");
  fs.mkdirSync(target, { mode: 0o700 });
  const directoryFd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const held = fs.fstatSync(directoryFd, { bigint: true });
    const assertCurrent = () => {
      const named = fs.lstatSync(target, { bigint: true });
      assert.equal(named.dev, held.dev);
      assert.equal(named.ino, held.ino);
      assert.equal(named.birthtimeNs, held.birthtimeNs);
    };
    const name = "destination.jsonl";
    const path = join(target, name);
    // Synthetic destination and receipt bytes exercise one atomic namespace entry.
    const bytes = Buffer.from('{"type":"session","id":"destination"}\n{"type":"fixture-receipt","from":"sourcé"}\n');
    publishDurableNewFile(directoryFd, name, bytes, assertCurrent);
    assert.deepEqual(fs.readFileSync(path), bytes);
    assert.equal(fs.statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(target), [name]);

    const incumbent = fs.statSync(path, { bigint: true });
    assert.throws(() => publishDurableNewFile(directoryFd, name, Buffer.from("replacement"), assertCurrent), {
      outcome: "not_published",
    });
    assert.equal(fs.statSync(path, { bigint: true }).ino, incumbent.ino);
    assert.deepEqual(fs.readFileSync(path), bytes);
    assert.deepEqual(fs.readdirSync(target), [name]);

    const symlinkName = "incumbent-symlink.jsonl";
    fs.symlinkSync(name, join(target, symlinkName));
    assert.throws(() => publishDurableNewFile(directoryFd, symlinkName, bytes, assertCurrent), {
      outcome: "not_published",
    });
    assert.equal(fs.readlinkSync(join(target, symlinkName)), name);
    assert.deepEqual(fs.readFileSync(path), bytes);

    const refused = new Error("fixture lost source authority");
    let checks = 0;
    assert.throws(() => publishDurableNewFile(directoryFd, "refused.jsonl", bytes, () => {
      assertCurrent();
      if (++checks === 2) {
        assert.deepEqual(fs.readdirSync(target).sort(), [name, symlinkName]);
        throw refused;
      }
    }), { outcome: "not_published", cause: refused });
    assert.deepEqual(fs.readdirSync(target).sort(), [name, symlinkName]);

    // Linux O_PATH still identifies the exact directory for linkat, but directory fsync returns EBADF.
    const oPath = 0x200000;
    const unsyncable = fs.openSync(target, oPath | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const unsyncedName = "unsynced.jsonl";
    try {
      assert.throws(() => publishDurableNewFile(unsyncable, unsyncedName, bytes, assertCurrent), (error: unknown) => {
        assert.ok(error instanceof Error && "outcome" in error);
        assert.equal(error.outcome, "outcome_unknown");
        assert.ok(error.cause instanceof Error && "code" in error.cause);
        assert.equal(error.cause.code, "EBADF");
        return true;
      });
      assert.deepEqual(fs.readFileSync(join(target, unsyncedName)), bytes);
    } finally {
      fs.closeSync(unsyncable);
    }

    const alteredName = "altered.jsonl";
    const retainedName = "retained.jsonl";
    const altered = join(target, alteredName);
    assert.throws(() => publishDurableNewFile(directoryFd, alteredName, bytes, () => {
      assertCurrent();
      if (fs.existsSync(altered)) {
        fs.renameSync(altered, join(target, retainedName));
        fs.symlinkSync(retainedName, altered);
      }
    }), { outcome: "outcome_unknown" });
    assert.equal(fs.readlinkSync(altered), retainedName);
    assert.deepEqual(fs.readFileSync(join(target, retainedName)), bytes);

    const legacy = "legacy-artifact.jsonl";
    publishNewFile(directoryFd, legacy, bytes, 0o640, assertCurrent);
    assert.deepEqual(fs.readFileSync(join(target, legacy)), bytes);
    assert.equal(fs.lstatSync(join(target, legacy)).mode & 0o777, 0o640);
  } finally {
    fs.closeSync(directoryFd);
  }
  assert.equal(guard.denied(), 0);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
