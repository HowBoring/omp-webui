# Native control-I/O selection prerequisites

Status: **PASS scoped source prerequisites; production BLOCKED**. This adds an exact launcher descriptor handoff,
a pure inherited-lock guard, strict signed composed approval, and a concrete exhaustive filesystem/platform selection
adapter. It does not load the public module or start a Native server. Structured identities are in
[ticket-41-native-control-selection.json](ticket-41-native-control-selection.json).

The first reserved argv member names the C launcher's actual descriptor, with no fd3 assumption or scan. The pure
main-only guard requires the signed canonical control path/device/inode, ordinary single-link mode0600 metadata,
read-only/no-follow inherited flags, and one self-fdinfo whole-file shared FLOCK owned by this PID. Every assertion
brackets the bounded self-fdinfo read with metadata checks. A locator alone supplies no authority. The guard exposes
no descriptor, close or unlock operation. Generation release cannot shorten the process-owned lock lifetime.
The launcher includes the exact canonical `control.h` policy from public artifact commit
`f30936d06c2c954bf896430390a97b41855919cd`; no alternate flock policy or pi-natives UDS lock is introduced.

Composed admission uses separate **anchor/2, approval/3 and signature domain/3**, with strict control-I/O ABI/binary/
C/header/inventory/public-package/native role identities. Legacy v2 remains historical public-client/UDS fixture
source only, with no fallback into composed admission. The new adapter requires nominal authenticated approval and
nominal inherited protection; structural callback fakes are rejected before their callbacks run. First construction,
including failure, consumes that immutable approval generation. Its verify order is retained guard, signed snapshot,
exhaustive release and platform closure, signed snapshot, retained guard. It does not rename the older approval.verify.

Inventory SHA256 authenticates exact bounded manifest bytes from the outside signature. All real directory rosters,
file bytes, modes, direct contained release links and platform dependency bytes are checked. Only release.json
excludes itself, preserving finalization before signing without a digest/build cycle. Linux ELF64 metadata checks
all reachable DT_NEEDED/PT_INTERP edges and explicitly signed interpreter aliases, rejects unused dependencies and
aliases, and repeats metadata/bytes around verification. Unsupported RPATH/RUNPATH/audit/filter/auxiliary extensions
fail closed. Bounds and identity encoding are in the Native documentation exported by inactive0010.

The public `@omp-webui/control-io` selection types were read from immutable f309 Git objects. The explicit temporary
compiler mapping checks compatibility with that existing contract; it does **not** install or resolve the production
package. `LinuxOwnershipServer.open` refuses missing/non-nominal composed admission before any bridge runtime import
and remains unavailable even with a selection, pending public package resolution and its actual load/lifetime owner.
No prepare ACK, spawn, socket, FFI import or library load occurs in the source test graph. Existing bridge source has
synchronous guard assertions immediately before and after dlopen for its later independently proven path.

Validation: **23 pure tests, 144 assertions, 0 failures**; **38 ownership source/test files** and the checker tool
strictly typechecked; C compiled with `-std=c11 -Wall -Wextra -Werror -O2`, zero diagnostics. The **16-module** pure/client
runtime import graph excludes server, bridge, FFI and public control-I/O runtime imports. Tests run with the pre-import
network guard, allowlisted environment and isolated HOME/profile/cwd. Signed synthetic records use existing public
RFC8032 fixture keys; no production key/approval is created. Exact captured output is in
[ticket-41-native-control-selection-checks.json](ticket-41-native-control-selection-checks.json).
Tests include malformed/duplicate/absent locators, fd3 socket metadata, unlocked/exclusive/wrong-owner/range/flags/inode
fdinfo, oversized data, path replacement and drift during brackets, sticky refusal, incomplete/extra/wrong-domain
approval, authority fakes, duplicate construction, inventory omission/mode/link/platform drift, and signed alias
omission/replacement/unused entries. A complete signed selection plus public module nominal/lifetime test is **NOT RUN**.

Read-only metadata feasibility also checked the actual pinned Bun (`10702245…`), existing control-I/O library
(`d97a49a0…`), and bridge candidate (`c4a0f5a6…`). Bun needs libc, ld-linux, pthread, dl and m, with interpreter
`/lib64/ld-linux-x86-64.so.2`. Its two actual aliases are `/lib64 -> usr/lib64` and
`/usr/lib64/ld-linux-x86-64.so.2 -> ../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2`. Explicitly signing both aliases and
five canonical dependency files satisfies the parser's supported metadata closure. No unsupported DT feature was
observed. Input bytes/metadata remained unchanged. Readelf and the guarded pure-source parser ran as tooling under
pinned Bun; no Native application entry or shared library was invoked/loaded, and actual mappings were not read.
This establishes static layout feasibility, not loaded-library identity or production selection. Raw metadata and
exact hashes are in [ticket-41-native-control-selection-elf.json](ticket-41-native-control-selection-elf.json).

Host and Native HEAD/index/staged/working/untracked changed files were preserved before editing. The original Native
HEAD/index/staged bytes remain exact. The old cumulative source tree matched `ac5bf3f7…`; exactly 15 intended Native
files changed. The final private-index candidate gives tree `72137ab0…`, patch SHA256 `8ed1a76f…` and source tuple
`02b06297…`. Active patches, consumer delta and final1–10 composition remain unchanged/unperformed. An earlier uncommitted authoring
candidate (`ab4942b5…`) was superseded after review found structural bridge callbacks could fake admission. The final
bridge requires the nominal complete approval and selection, exact approved bridge path/digest and main-thread guard
before dlopen. The earlier patch preimage is preserved, labeled NOT RUN, and never committed/activated; two authoring
exports produced one final published cumulative candidate.

The old C launcher proof remains historical for source `581a2259…`: its 19-surviving-input/13-raw revalidation predates
this authorized C edit. Exact old C bytes are archived from the preserved Git HEAD. Its original top-level parent
tool exit remains **NOT_CAPTURED**. The new C argv source (`4660a3ca…`) needs new actual handoff evidence; no old proof
was rerun or promoted. The old anchor/UDS proof retains its original v1 tuple. Native application/helper behavior,
public module resolution/load/disposal, actual global installation, private admission and #41/#61 completion remain
**BLOCKED / NOT RUN** as applicable.
