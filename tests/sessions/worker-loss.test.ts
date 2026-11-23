import { expect, test } from "bun:test";
import type { DrainResult } from "../../packages/compatibility/stdio-transport.ts";
import { sourceFixture } from "./source-fixture.ts";

const drain = { code: 7, forced: false, stderrBytes: 12, stdoutEOF: true, stderrEOF: true };

test("a lost worker releases its slot before reader EOF is observed", async () => {
  const f = await sourceFixture();
  const completion = Promise.withResolvers<DrainResult>();
  f.controls.retirement = { status: "pending", completion: completion.promise, stdoutEOF: false, stderrEOF: false };
  try {
    const opened = await f.supervisor.open(f.identity, f.selected);
    await f.exitWorker(drain.code);
    // The root handle is gone; nothing can use this reservation again. Reader EOF is diagnostic only.
    expect(f.supervisor.hasOwnedReservation).toBe(false);
    const reopened = await f.supervisor.open(f.identity, f.selected);
    expect(reopened.workerId).not.toBe(opened.workerId);
    expect(f.supervisor.starts).toBe(2);
  } finally { completion.resolve(drain); await f.close(); }
});

test("idle retirement with an unobserved reader frees the slot", async () => {
  const f = await sourceFixture();
  try {
    await f.supervisor.open(f.identity, f.selected);
    f.controls.retirement = { status: "closed",
      drain: { code: 0, forced: false, stderrBytes: 0, stdoutEOF: true } };
    const created = await f.supervisor.create(f.identity, f.cwd);
    expect(created.state).toBe("open");
    expect(f.supervisor.starts).toBe(2);
  } finally { await f.close(); }
});

test("an explicit stop with an unobserved reader frees the slot", async () => {
  const f = await sourceFixture();
  try {
    await f.supervisor.open(f.identity, f.selected);
    f.controls.close = async () => ({ code: 0, forced: false, stderrBytes: 0, stdoutEOF: true });
    f.grants.revoke(f.grant.id);
    await f.supervisor.permissionsChanged();
    expect(f.supervisor.hasOwnedReservation).toBe(false);
    f.grants.confirm(f.grants.preview(f.cwd).confirmation);
    const reopened = await f.supervisor.open(f.identity, f.selected);
    expect(reopened.state).toBe("open");
    expect(f.supervisor.starts).toBe(2);
  } finally { await f.close(); }
});
