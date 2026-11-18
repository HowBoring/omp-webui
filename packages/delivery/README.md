> Source normalization: this copy belongs to the unregistered H/public-P source tuple. Historical results below apply only to their original artifacts. See [ADR 0026](../../docs/adr/0026-unregistered-supervision-prerequisites.md) and the new tuple evidence; actual composed runtime/global/private admission remains BLOCKED.

# Operator delivery preparation (#41)

This module is an isolated Linux delivery preparation seam. It never starts OMP, imports native internals,
opens Session data, authenticates a publisher, certifies actual-global scope, or grants product Session admission.
`inspectDeliveryGate()` always returns `status: blocked` and `sessionAdmission: blocked`. A structurally valid
inventory is `unaccepted-artifact`; it cannot stand in for the final native/DSH/schema/semantic evidence.

## Interfaces and supported layout

`writeReleaseManifest({ root, platformDependencies })` is an explicit operator build action. `root` must be an
absolute canonical directory. It enumerates **every** member, rather than trusting a caller's selected tree list.
The manifest records content, modes, direct link targets and directory membership. Only root `release.json` is
excluded. Required nonempty directories are `bin`, `runtime`, `worker`, `native`, `host`, `client`, `contracts` and
`provenance`. Required files are `bin/omp`, `runtime/bun`, `runtime/bunfig.toml` and `worker/cli.js`; launcher/runtime
must be executable. Hardlinked members, absolute links, indirect internal links and symlinked package ancestors
are unsupported. Internal relative direct links are inventoried together with the target's ordinary membership.
Existing linked/hardlinked manifest destinations are refused; publication uses a unique temporary file and rename
so enrollment does not write through an external manifest link. This is not a power-loss durability promise.
Platform dependencies use the existing v1 file/link members: normalized absolute paths outside the release,
canonical parents, and either canonical single-link regular files with SHA256 identities or relative aliases with
exact nonempty readlink text and modes. Directory aliases are link members, never directory members. Aliases are
accepted only when encountered while resolving a required ELF PT_INTERP pathname. Every alias must be inventoried;
final interpreter files must be canonical inventoried files. Absolute, unsigned, unused, cyclic, dangling or
wrong-target aliases refuse inspection. This does not admit arbitrary symlinked ancestors for other files.

All release files and recursively reached platform libraries are checked for supported Linux x64/arm64 ELF64
little-endian DT_NEEDED/PT_INTERP closure. Providers must be unambiguous; unsupported loader search tags refuse.
Canonical-only layouts remain supported. Non-ELF source fixtures with no dependencies remain valid. Metadata reads
never execute ELF, invoke a loader, import Native ownership internals or establish actual runtime mappings.

`inspectRelease({ root, expectedIdentity })` requires a SHA256 supplied from independent reviewed operator
configuration. It checks the exhaustive inventory and platform dependencies. It does not derive approval from
`release.json` or regenerate enrollment. The root is explicit, so relocation has no project-layout `../..` assumption.
Inventory limits are 200,000 members, depth 64, 8 GiB total package files, 1 GiB per file, 256 platform members and
32 MiB manifest bytes. ELF metadata uses at most 128 program headers, 1 MiB bounded metadata reads and 256 needed
names. Interpreter resolution permits at most 16 links and 256 components. Exceeding a budget refuses inspection.
These are artifact-control budgets, not Native scan/RPC budgets.

A retained generation observes nonmember ancestor/traversal directories by device/inode, uid/gid, full mode/type
and canonical path. Unrelated child changes to their link count, size or timestamps do not invalidate selection.
Release members, inventoried platform aliases and target files retain full snapshots, including link count, size,
nanosecond change/modify timestamps and exact link text where applicable; release directories also retain exhaustive
child rosters. Promotion from ancestor to member first checks retained identity, and full member observations
permanently dominate later ancestor requests and rechecks. These are observed stability facts, not owner/device/inode
fields authenticated by v1. File reads use O_NOFOLLOW and compare held-descriptor and named identity before and after
reads; traversal/hashing ends with an observation recheck. Same-content replacement refuses verification.
Verification is serialized and any failure permanently latches bounded, typed
`RELEASE_UNVERIFIED` for that generation. The exposed manifest is frozen. A failed held verification does not
automatically release the caller's retained maintenance lease. Ancestor replacement, ownership, permission, type
or canonical-path changes still refuse. Independently pinned approval and cooperative maintenance remain
necessary; this does not defend against hostile same-UID/root writers.

`resolveGlobalSelection({ entry, root, expectedIdentity })` accepts only an explicitly selected absolute entry:
the exact inventoried `bin/omp`, or a direct link to it with canonical ancestors. It rejects shell/package-manager
shims, indirect links and alternate interpreters without executing them. It never searches PATH. The operator still
must establish that this is their ordinary global TUI entry; a temporary path, package version or directory label
cannot supply that evidence.

`inspectCoordinatedSelection({ ...selection, control })` acquires a shared lease **before** reading release bytes,
then resolves/verifies the selected entry, and retains the lease until explicit `release()`. `verify()` checks the
control inode before and after rechecking entry/closure. Use it for preparation only. A future worker adapter must
retain the lease through safe preflight, actual mappings, worker lifetime and drain; this module is not wired into
product open/create/restart and cannot authorize any of those operations.

## Coordinated maintenance contract

`acquireMaintenanceLease({ path, device, inode }, "use" | "update")` uses real Linux `flock`, nonblocking shared
or exclusive. Independently approved device/inode identity, canonical pathname, regular-file type and single link
are checked through both the opened fd and pathname, before and after acquisition. Unsupported/replaced controls
fail closed. Exclusive acquisition refuses existing readers; shared acquisition refuses maintenance. There is no
waiting for or killing an unknown TUI. All failed acquisitions close the fd. An explicit `release()` is idempotent.

The control inode must be pre-provisioned **outside** every replaceable release, launcher and dependency tree.
It must survive entry retargeting and every upgrade. Never unlink, rename, recreate, truncate-as-replacement or
republish it. Every maintenance participant independently pins that same device/inode. Parent directories and
all closure writers must be under the supported operator maintenance policy; arbitrary package-manager updates
or writable installations outside that policy remain unsupported/BLOCKED. Hash-before/hash-after alone supplies
no stability guarantee. This cooperative contract does not defend against hostile same-UID/root writers,
replaced mounts or another process deliberately bypassing the agreed entry and maintenance protocol.

`buildControlledLauncher({ root, control })` builds a small static C ordinary entry under `bin/omp`, pinning the
stable control path/device/inode. It refuses a control path inside the release. This is an operator build action,
not Host startup or a browser facility. The C entry acquires its own shared flock before exec, derives release
root from its actual `/proc/self/exe`, and execs `runtime/bun --no-env-file --config=<release>/runtime/bunfig.toml
<release>/worker/cli.js <ordinary OMP arguments>`. It performs no shell/PATH lookup. It preserves PID, original cwd
and ordinary arguments. The lock fd has CLOEXEC cleared and remains owned by that process across exec and through
its lifetime. Exit 73 means acquisition was refused; exit 74 means unsupported/control/exec failure. Stdout remains
untouched. The static executable rejects BUN_OPTIONS, NODE_OPTIONS, BUN_INSPECT, LD_PRELOAD, LD_LIBRARY_PATH and
LD_AUDIT before exec. The reviewed Bun config must explicitly control preloads, including `preload = []` when none
are intended. Ordinary profile/HOME/cwd are not silently changed. Public safe-preflight still requires the existing
synthetic HOME/profile/TMPDIR/cwd and allowlisted environment, before any native Session/UI operation.

Pinned Bun 1.4.4 experimentally requires `--config=<absolute>` as one argument here. The separate-argument attempt
was a test-development mistake: it left default preloads active and treated the following config as an entrypoint.
The retained positive uses the correct spelling and verifies actual target PID/argv. Synthetic cwd bunfig and
HOME/XDG `.bunfig.toml`/`bunfig.toml` preload files are suppressed in the real Bun fixture.

The C entry is a packaging adapter, not a second Agent or hidden worker. Its installed bytes, compile source,
compiler identity, runtime, reviewed config and full target/deferred load closure must be included in the approved
artifact. Compiling in the target control inode is installation-specific: retargeting to another independently
provisioned control requires a rebuilt/reviewed launcher and new inventory identity. Relocation preserves package
relative resolution on the same approved platform/control; it is not a cross-machine immutable-release claim.

## Maintenance sequence and unresolved lifetime boundary

1. Fence new application work. Cooperatively stop and drain owned WebUI workers. Do not end unknown TUI users.
2. Obtain the **same** exclusive lease. If a TUI/Host reader remains, refuse maintenance and report occupation.
3. Build/verify the complete new tuple and current-data/TUI compatibility on isolated data. Publish only the reviewed
   release/entry under this lease; platform dependencies require the same coordination or a separately proven
   immutable mechanism. Never substitute a project vendor candidate or hidden additional production worker.
4. Verify final entry, complete bytes, independent approval and semantic evidence at the actual selected global
   location. Publish the independently trusted tuple approval only after all gates pass, then release maintenance.
5. Every ordinary TUI/Host generation takes a shared lease before loads. Host verifies again under its retained
   lease, binds actual Native PID/runtime mappings/effective public guarantees, and checks all auth/ownership limits.

This sequence is **not yet a supported installation**. Direct worker exit releases that process's fd, but does not
prove private descendants or shared brokers are gone. Such processes may continue to load release bytes after
worker exit. They require public native ownership/lifetime semantics and their own valid maintenance leases (or
another proven containment/coordination arrangement). `S1-CHILD-OWNERSHIP-FOLLOWUP` remains unresolved. No cleanup
or immutable-global capability is published. Unknown detached/shared lifetime, platform update policy, missing
final native/DSH combination or absent actual-global target keeps the gate BLOCKED.

## Operator report

`bun --no-env-file scripts/inspect-delivery.ts` emits sanitized JSON and exits 2 (blocked). With no configuration,
its code is `GLOBAL_TARGET_NOT_SELECTED`. Optional trusted startup configuration uses
`OMP_WEB_DELIVERY_SELECTION` to name a stable regular file of up to 65,536 bytes. Its strict JSON fields are
`root`, `entry`, the independently approved `expectedIdentity`, and `control: { path, device, inode }`.
Invalid configuration produces `DELIVERY_SELECTION_INVALID` without including paths or config contents.
Valid component inspection reports `DELIVERY_COMPONENTS_ONLY` and the outstanding evidence.
The command inspects explicitly selected components without discovering or running OMP.
