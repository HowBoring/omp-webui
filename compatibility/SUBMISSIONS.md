# Native durable submission component (#36)

This isolated S0 candidate adds `0007-durable-submission.patch` after the complete ordered 0001–0006 stack.
The source includes the accepted live helper and the current strict-generation source. The resulting source/schema
identity describes the whole stack; neither prerequisite's individual tuple describes this combined artifact.
Private product Session admission remains blocked.

The public interface is `submission_submit` (flat source/instance/native Session identity, stable client key,
preparation identity, input kind, text/images) and `submission_query` (key, offset, limit). Every result reports its
current target, original target, local/inherited admission, reservation, input generation, terminal status, overall
persistence and paged exact native entry/no-entry relations. `availability: removed` retains an original committed
fact after native pruning or a path copy. It does not claim that the destination retained that payload. Read
[ADR 0014](../docs/adr/0014-native-durable-submission.md) and the authored native `docs/rpc-submissions.md` for
semantics and fixed limits. Unsupported storage refuses admission; an ownership probe or ordinary no-op claim
cannot provide this guarantee.

The tests exercise actual public rpc-ui workers under synthetic HOME/profile/cwd and a pre-import provider guard.
The controlled extension registers literal in-process provider/tool boundaries; it never calls real inference.
Native copy/rewind/reader/TUI tests are complementary native public-data seams, not Host SDK integration. Host
runtime never imports native SessionManager or reads native Session files.

```sh
export PATH=/workspace/work/rpc-public-module-probe/tooling/bun/package/bin:$PATH
bun scripts/prepare-compatibility.ts --reset --source-only
# Supply a readonly dependency link only in the owned ignored checkout.
bun scripts/build-compatibility.ts
bun scripts/build-compatibility.ts --check
bun scripts/build-continuation-fixtures.ts
bun test tests/submissions
bun scripts/check-submission-native.ts
bun run check
```

Network-enabled execution is required for genuine native OS leases and loopback browser tests in this sandbox.
The syscall controller traces only its deliberately spawned synthetic child, never attaches to a process, and
uses EXITKILL plus owned child cleanup. Fault logs must demonstrate that the selected real write/crash cut fired.
Reservation-before-dispatch means recovery never needs to guess whether an input should run again.

The actual DSH ingress/recovery fixture is in `experiments/submission-seam`. Build its own client controls with
`build-fixture.sh`, launch `host.mjs` with the readonly canonical DSH source and an ignored evidence directory, then
run `browser.py`. It deliberately loses the Remote response after native admission, refreshes the page with the
same frozen semantic marker, restarts the worker, and resolves acceptance through public native query. This proves
component ingress recovery only; its displayed seed history and session aliases are fixture presentation.

Windows/WSL2 is deferred by the owner. Product attachment originals/preparation, multi-holder history reset,
production admission, global runtime enrollment and full-MVP performance/maintainer acceptance remain separate.

The queued-source correction is currently a source-only checkpoint. Protected submission ingress revalidates its native
lease, namespace, cwd and origin inside the input queue before the first hook and after awaited ingress checks.
`submission_submit` uses the same background admission path as prompt, so query can observe its durable reservation
while ingress waits. Loss of protected authority leaves unpublishable completion unknown. The actual public-worker
regression in `tests/submissions/queued-source.test.ts` is authored but execution is held during the prerequisite gate;
`compatibility/evidence/submission-checkpoints/queued-source.json` records this limit. Existing generated identities and
the ignored executable still describe the preceding built checkpoint until a scheduled clean rebuild.
