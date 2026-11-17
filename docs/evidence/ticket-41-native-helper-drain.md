# Native helper terminal eligibility — inactive source

Explicit approval/4 now permits Native to establish its own helper terminal eligibility from trusted COMPLETE,
original retained SO_PEERPIDFD exit, authenticated durable helper-fence absence, and local quiescence. Host still
independently needs its original helper wait and clean control EOF/tail before releasing its lease. Native observes
neither Host reap nor helper exit status or Host receipt. No public release RPC was added.

Strict anchor/2 → approval/3 and its ANY-prepare retention rule remain unchanged. V4 requires a separately selected
anchor/3 and signature domain/4, exact signed helper-fence policy/directory, and a helper digest matching approved
helper bytes. Exhaustive inventory must include actual C source, headers, generated configuration and build script;
the generated configuration must match the signed inputs. This authenticates reviewed build provenance rather than
claiming to decode compiler constants from a binary. Future operator assembly must produce these from one reviewed
input. No actual approval or keys were produced.

Prepare remains committed if its reply is lost. Used-generation tombstones and original controller/helper/wire-session
correlation survive COMPLETE and terminal observation. Unmatched prepare, uncertain REGISTER, wrong session,
EOF/exit without trusted COMPLETE, live peers, scopes and uncertain resources stay blocking. Completed peers are
checked through their retained pidfd; terminal checks never rediscover their PID or inspect `/proc` after exit.

Native holds authenticated helper-fence directory/file descriptors. New read-only C primitives use `openat` and
`fstatat(AT_SYMLINK_NOFOLLOW)`, validate ownership/modes/content/identity, and seal exact-name absence through directory
fsync and recheck. Replacement, unknown entries and I/O/fsync/close failures retain sticky uncertainty. Native never
unlinks helper fences. The actual private helper's fence-clear-before-Host-COMPLETE ordering is unchanged and may
coexist with Host delivery failure; external fix5's stronger ordering supplies no private-mode proof.

Server close stops admissions and listener acceptance while registered helpers and COMPLETE ACK output keep polling
with per-write owner checks. Terminal checks serialize with the response tail. Terminal entries, empty scopes,
settled output and callbacks, and a final stable-tail check precede endpoint verification and resource disposal.
Helper-fence descriptors close before their containing bridge; dispatcher-fence descriptors follow, then awaited
public-module close and selection release last. The C maintenance descriptor remains process-owned until exit.
Failed or uncertain shutdown never becomes successful through a timeout or a second close call.

[Checks](ticket-41-native-helper-drain-checks.json): 105 pure tests / 949 assertions, strict nominal types for 53 files,
strict C shared compilation with zero diagnostics, and build-only AST checks with zero eager FFI imports. Pure
fixtures use approved System/Storage/Peer/public-module interfaces under a preimport no-provider/no-process/listener
guard and synthetic env-i HOME/profile/cwd. The real public JS/library, Native CLI/SDK/Agent, actual helpers,
controllers, sockets, pidfds and helper-fence syscalls were not executed. The compiled test library was never loaded.

[Export provenance](ticket-41-native-helper-drain-export.json) records all 17 changed source files and digests.
The original Native HEAD/index/staged bytes are unchanged: 120 of its original 130 dirty paths remain byte-identical
to the prior inactive tree, and the 10 intentional edits have exact bounded preimages. Seven new source/test files
were added. A private index replayed unchanged first1–6 and only inactive0010 to the exported tree. Active patch
selection, consumer delta and 7–9 composition were unchanged; full1–10 was not activated or claimed.

The c17750a signed C→Bun no-prepare proof remains historical and exercised no helper. Its consumed stageB keys/runtime
were retired and were not reused. This source's actual helper drainage is **NOT RUN**. Fresh paired source review,
then separately authorized two-process Native/Host/trusted-C helper evidence with backpressure/fault cases and fresh
signed configuration are still required. Ordinary entry, broker/external protectors, final composition, actual global
provenance and private admission remain **BLOCKED**. Tickets #41 and #61 remain open.

[Machine-readable summary](ticket-41-native-helper-drain.json) includes contract pointers and raw RED/GREEN hashes.
