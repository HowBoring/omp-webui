# First C argv / signed Native public-module probe source

Status: **CORRECTED SOURCE ONLY — UNSIGNED, NOT APPROVED, NOT READY**. The prior signed
attempt actually **FAILED before the first Native-bearing import** and fully drained;
see [the preserved actual FAIL](ticket-41-native-signed-probe-actual-fail.md).
The corrected source has no new build, signature, READY or runtime attempt. Original source preparation was based on clean Host
`8988a5afd71c38f91fb188362aff174f6a4d31c9` and the existing inactive0010 tree
`12f724d5f69471f2e91317475caac3bb911b50d2`. The fresh publication Spec and Standards reviews each found zero issues.
This change does not alter Native authoring bytes, active patches, patches1–6/7–9, consumer delta, or final1–10 composition.
Normal dispatcher entry and broker creation remain unavailable. Every committed prepare still prevents generation disposal.

The fixture source is an explicit independent operator bootstrap, not a normal Native entry or a hidden production
installation. It performs **no prepare, helper, Native Agent, provider, broker creation, or product Session operation**.
Its only requests use the existing production Native public client: classify/list empty scopes, inspect a missing global
`browser-relay` generation and require the signed `dispatcher_unavailable` refusal, then list empty scopes with a fresh
client. The production client owns and closes each original transport. A refusal or no-create failure stops the probe.

## Layout and authentication

The production C source is unchanged: SHA256 `4660a3ca0fa21633eed7015182b4e1e9b7f3d67b63355734bbb6555b3596088b`.
It rejects environment preload injection and controller-supplied reserved argv, obtains the stable control inode's shared
FLOCK and execs the canonical real Bun in the **same PID**, supplying the exact internal fd locator. No fd3 guess, fd
scan, environment handoff, shell delegate, symlink, hardlink or relaxed C validation is introduced.

The existing Native approval contract requires `entry` outside `releaseRoot`. The bounded fixture therefore uses:

```text
/tmp/native-signed-probe-<attempt>/
  operator/{anchor.json,approval.json,key.json}    # Root-owned, outside both inventories
  control                                      # stable 0600 inode; actual C shared FLOCK
  launch/
    bin/omp                                    # actual C executable, signed entry pin
    runtime/{bun,bunfig.toml,no-provider.js}     # one real pinned Bun; reviewed config preload
    worker/cli.js                              # Native-free authenticated bootstrap
    launch-closure.json                        # entire launch roster plus 5 OS files / 2 aliases
    components/
      native/{probe.js,dispatcher.ts,client.ts,unavailable-entry.ts}
      contracts/{ownership.schema.json,protocol.ts}
      control-io/… lib/… provenance/… release.json
  home/ profile/ cwd/ config/ data/ cache/ xdg-state/
```

`approval.identity.closure` signs the SHA256 of **launch-closure.json**, including every outer bootstrap/runtime/config/
guard/C entry byte and the complete inner component directory. The distinct `controlIo.inventory.sha256` signs the
strict Native **component** inventory. These identities must not be conflated. Root independently freezes every launch
file, both inventories, the five OS dependency files, actual approval/anchor/key/control, marker, retainer and Python in
the final READY manifest. Signed aliases are `/lib64 -> usr/lib64` and
`/usr/lib64/ld-linux-x86-64.so.2 -> ../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2`.

The C-approved bunfig preloads the exact no-provider guard before bootstrap evaluation. The Native-free bootstrap uses
its compiled stable anchor pin, anchor/2 and domain/3 Ed25519 signature to authenticate the full launch inventory and
OS bytes/aliases **before its first Native import**. The actual Native bundle also checks the preloaded guard before
initializing its lazily bundled Native modules. Production `loadOwnershipControlApproval`, the exact inherited guard,
`selectOwnershipControlRelease`, and `LinuxOwnershipServer.open` then enforce the real nominal approval/selection/owner
path. The real public JS `868251d0…` and library `d97a49a0…` must load successfully before Native bridge/listen. No Host
runtime owner or control-I/O implementation is imported or copied into Native.

The inner ELF graph contains the real control-I/O and ownership libraries and their libc/loader dependencies plus the
two required interpreter aliases. The outer Bun graph additionally binds libdl, libm and libpthread. The component
inventory must not list unused outer dependencies: Native rejects unused dependency authority. Root must independently
review the exact final graphs, bytes, modes and inventories before signing. Required unused helper/validator roles name
inert source files, explicitly granting **no executable helper or full validator capability**; this is not a production
matched-release or global provenance proof.

## Shutdown and independent wait ownership

The probe emits READY only after the three read-only client checks and empty fences. Its independent Python parent
owns the original stdin/stdout/stderr, original direct-child pidfd and sole P_ALL wait loop. It verifies single-threaded
untraced self and subreaper state, obtains initial P_ALL/ECHILD, admits one C launch, verifies the original child through
P_PIDFD/WNOWAIT, and closes only that original stdin after matching READY from the original PID. Each new attempt needs
new bytes/pins, Root approval and a fresh directory; an exclusive one-run claim prevents rerunning a frozen attempt.

With **no prepare**, awaited production `server.close()` follows bridge/fence cleanup → public module close → selection
release. The fixture observes fulfilled close, refusal by the released selection, empty fences and a still-current C
descriptor guard. Those are production lifecycle contract observations, not independent proof of unmapping every DSO.
The process-owned C lock remains held until Bun exits. The parent requires original root exit0, pidfd kernel exit,
both original reader EOFs, final authoritative P_ALL/ECHILD, absent endpoint, empty fences, and exclusive control lock
availability after exit. It never uses census emptiness, child discovery, numeric PID fallback, group kills or signals.
Timeout/observer failure requests original stdin EOF and retains wait ownership; elapsed time is never extinction proof.

Pipe ends and opened logs are registered before subsequent fallible setup. Every launch exception closes the parent's
copies of child-side stdin/stdout/stderr ends; partial setup with no child can therefore reach actual reader EOF and
P_ALL/ECHILD, producing FAIL. A post-spawn pidfd failure preserves the original child identity and readers through the
sole wait loop. Each output reports its actual outcome: NOT_CREATED, PENDING, EOF, or FAILED. Only a zero-byte original
read records EOF; `originalReadersEof` requires both original outputs to report EOF. A nonrecoverable raw-read error
records FAILED and requests original stdin EOF. Its descriptor remains owned until authoritative P_ALL/ECHILD and all
remaining readers reach a terminal outcome; the report is FAIL with `originalReadersEof:false`. Interrupted/nonblocking
reads and unresolved wait/observer failures remain pending. A deadline never authorizes release.

## Preparation and readiness handoff

`scripts/prepare-native-signed-probe.ts` is a source/build action; the corrected source is **unexecuted**. It requires Root to supply a protected
configuration with `stage`, `installation`, stable `anchor` pin and separate dispatcher `key` pin. Root creates these
synthetic operator records independently; the builder creates no keys, trust, signature or READY authorization.

After independent source review, Root may invoke that source/build action for a fresh attempt, using synthetic HOME,
profile, cwd, XDG directories and `TMPDIR=/tmp`. `--materialize-one-runtime` permits exactly one necessary owned real
Bun at `launch/runtime/bun`: forced CoW clone first; exact byte copy if unsupported; no second copy. The runtime must
match pinned Bun SHA256 `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`. Without materialization,
the builder's partial inventories are explicitly NOT READY and cannot be signed/promoted without rebuilding a fresh
complete attempt. No runtime materialization or builder execution occurred in this source task.

The builder writes the exact unsigned v3 payload in `approval-request.json`, provenance source graph, strict component
inventory, full launch inventory, and `NOT_READY.json`. It compiles/assembles only; no output is executed or imported.
Root must independently review final bytes/closure, authenticate both dependency graphs, sign that exact payload with
the dedicated approval key, and preserve the final approval/anchor/key pins. A fresh source review is insufficient to
claim final artifact review. The committed [unsigned request](ticket-41-native-signed-probe-request.json) and
[NOT_READY manifest](ticket-41-native-signed-probe-not-ready.json) contain no fabricated final identities.

The final READY must use format `omp-native-signed-probe-ready/1`, status `ROOT_APPROVED_ONE_RUN`, exact `stage`,
`prepareAuthorized:false`, `helperAuthorized:false`, `nativeAgentAuthorized:false`, and BLOCKED private/global admission.
Its `inputs` list must contain canonical regular-file `{path,device,inode,uid,mode,sha256}` pins for every executable closure
member, both inventories, OS files and the independent inputs described above. The Root-owned final READY digest and a
separate explicit one-run authorization are prerequisites to invoking `retain-native-signed-probe.py`. No runnable operator READY file
or runtime authorization was produced here; pure manifest tests create and remove inert temporary READY fixtures.
The retainer refuses the committed NOT_READY manifest.

Stage files remain current-UID owned, including strict 0600 operator/control pins. The exact canonical Python and five
fixed OS library paths may use their independently pinned readonly system UID; this workspace exposes them as UID 65534.
This explicit system scope also permits root-owned readonly bytes. No other outside file or stage file gains that exception.

## Source checks and limits

The accepted complementary public SDK/provenance fault seam tests cover occupied scopes, signature/authentication error
propagation, no-create failure, and a real Ed25519-signed **pure fixture** whose changed bootstrap bytes are rejected
before any Native import. These tests create no nominal Native approval/selection/owner. They are fault checks, not
claimed historical RED-before-GREEN runtime evidence. The first strict type check failed because the initial global
scope omitted its required service; its raw failure is preserved and the corrected exact public scope passes.

Root's source read found that the initial READY gate wrongly required readonly system files to use the stage UID.
Two pure Python tests drive the exact public `verify_ready` function through AST-selected code, without importing the
retainer, ctypes, its main block or launch/kernel paths. The real readonly-system rejection is preserved as RED; GREEN
accepts exact independently pinned system owners and rejects a stage file claiming a system UID. The test's closure
fixture paths were also corrected before GREEN; they were not the initial rejection. Native operator pins remain strict.

The focused review found a real pre-spawn writer leak. Five AST-extracted public Retainer tests use inert OS adapters
for all three pipe failures, occupied/unavailable logs, cwd failure, post-spawn pidfd acquisition failure, raw-read errors
before and after ECHILD, failed-reader close error, and transient reads past the diagnostic deadline. The preserved RED
shows the original writer leak; GREEN verifies actual fake-boundary EOF/ECHILD and honest FAIL. A separate raw-read RED
shows the uncaught error before FAILED-terminal handling; no runtime execution is claimed. The first harness also
misclassified the child-side stdin read end as an output reader; that assertion was corrected before the preserved
corrected RED. The original failure and correction are both retained. These tests extract only the Retainer class;
they never import the retainer module, ctypes, main, Native, or execute real spawn/wait/pidfd/lock/socket operations.

Checks and exact hashes are in [source evidence](ticket-41-native-signed-probe.json). C compilation and bundled outputs
are build evidence only. No emitted module, C entry, Native application, library, FFI, socket, process lock, kernel
fixture, SDK/TUI application, browser or process census ran. Unit test signing used fresh in-memory synthetic test keys;
no operator/production key or signed approval was created by those source checks.
Root subsequently built and signed one actual C/Bun attempt; it failed in Native-free
launch authentication before Native composition. Global/private admission remains
**BLOCKED**. No #29/#41/#61 completion, publication, push, PR, merge or closure is claimed.

## Launch roster order repair

The actual failure exposed an insertion-order defect. The scanner emits
`path,kind,mode,identity`, while strict parsing emits `path,kind,identity,mode`.
The comparison now validates the observed roster with the same strict schema before
comparing both ordered arrays. Only record field insertion order is normalized:
array order, counts, duplicates, paths, kinds, modes and content identities remain
exact. Signature/closure digest, operator pin, alias, platform and runtime checks
are unchanged; no Native, C, guard, API, schema or vendor source changed.

The public Native-free `authenticateProbeLaunch` test first reproduced the actual
`PROBE_LAUNCH_CLOSURE_CHANGED` on an unchanged genuinely signed fixture. It now
accepts that fixture and still rejects changed bootstrap bytes. Only external
`process.execPath` is substituted to an inert fixture runtime path and restored
afterward; filesystem traversal, strict schema parsing, canonical operator records
and Ed25519 authentication are real. Neither inert entry nor runtime fixture is
executed, and no Bun copy is made. Five focused tests and strict type checking of 29 files pass. Raw RED,
GREEN and final records are linked in the source evidence JSON.

The previous consumed READY is historical and cannot authorize a retry. Root
reclaimed its old owned stage runtime after the evidence-first commit. A fresh
attempt requires independent focused source review, new configuration/build,
independent final closure review, signature, frozen READY and separate one-run
authorization. This source repair executes none of those steps.
