# #41 R17 actual pre-START failure and manual disposition

**R17 FAIL: guardian exit 74 before HELLO/START. No current-C backpressure PASS.**
The consumed one-use window remains failed after manual disposition. Product/private Session and global
admission remain BLOCKED. This evidence does not close [#41](https://github.com/HowBoring/omp-webui/issues/41)
or [#29](https://github.com/HowBoring/omp-webui/issues/29).

The [adjacent summary](ticket-41-current-backpressure-r17-actual.json) records exact identities, tool chunks,
receipt/review SHA256 and the 19 immutable manifest members. Provenance paths are relative to the local
`/workspace/work/mvp-implementation` evidence store; raw logs, runtime artifacts and private bytes are not
included in this commit.

## Exact window and historical source seal

Source commit `b38e5a69caf1de8888ef36799740d1f021fafa30`, tree
`18b04962404fadee4fa18aceea271188a18dc8c8`, uses production base
`602f4988c7e09b8d3d7d708b07fc36e4516b560a`. All eight existing Source additions, including
the [Source report](ticket-41-current-backpressure-source.md) and its JSON, remain byte-identical.
Their SOURCE READY/runtime NOT RUN labels describe their original source/sealing boundary. The sealed
manifest's READY_NOT_RUN/NOT_RUN labels likewise describe sealing time; they do not describe this later
consumed window. This separate report records the actual result without rewriting those sealed inputs.

Stage: `/tmp/omp-external-current-backpressure-r17-20261117`.
Marker: `external-current-602f498-backpressure-r17-v1`.
Generation: `37ac51764927b879cc9bf0256b629ae013f64400803424d2eb8ef35e2bf26c91b`.
Manifest SHA256: `e15903d6a8e00986fcd19a7e38bcc11f7b40b4250a15237922ca2d78b057cb41`.

Fresh paired Root Source reviews and separate unsigned-artifact reviews were GO for their stated scopes.
Root separately cleared one exact-manifest runtime window. Preparation `084b33`, root compilation
`e36f8a`, protector compilation `ec0f57` and sealing `08eb7d` each reached exit 0. These are preparation
receipts, not runtime acceptance.

## Actual result

Original runtime tool `50c330` retained session `20749`. Poll `58cb89` reported HOLD with original owners
retained and recovery INELIGIBLE_OR_FAILED. The preserved audit records guardian `675659` as zombie Z,
parent `675655`, raw exit status `18944` (exit 74), with its original held PIDFS identity `5:685038`.
The controller reached HOLD before HELLO: no emitted before-business gate, Root START command, START,
business-start marker or fence was established. There is no accepted EAGAIN/filler, held-ACK protection,
drainage, COMPLETE or normal cleanup result.

Receipt `9a8bce` records all 19 manifest members and 137 Native files unchanged, including Native
HEAD/status/index/staged/unstaged state, after the failure and before manual disposition. Business-start
was false and fences were empty. This is input preservation, not fixture PASS.

## Separately approved manual action

Fresh paired manual Source GO preceded Root's literal clearance for exactly the original controller
`675655` and outer Python owner `675650`. The manual receipt records twice-validated original objects,
one SIGKILL through each bound pidfd, controller terminal observation before outer revalidation/control,
and kernel terminal observations for both. Bound PIDFS identities were controller `5:685034` and outer
`5:685029`. Guardian `675659` was already terminal and received no handle acquisition or signal.

Manual supervisor tool `3bbd72` reached EOF/exit 0. Its result is **MANUAL_KERNEL_TERMINALS_ONLY**, fixture
FAIL, normalPass false and automaticCleanupAcceptance false. Manual receipt SHA256:
`cddf323e8ee6132059f899ce03e453f815344db48f2b65f53ed70c8c1cb57ca0`.
Original tool `20749` separately reached EOF in `9713bc`, exit 137, still reporting retained HOLD/Refusal.
Its complete three-object tool array has SHA256
`e7ae6704cac782f233af7ccbfef7bdaaa07539ba66ffb1612c375168ec187b02`.

Original parent wait/reap, ECHILD and general descendant extinction are **NOT_ATTESTED**. Tool EOF and
kernel terminal observations do not establish those missing proofs. The frozen outer runner waits for
the business marker before its normal child-wait path, so this pre-START disposition cannot attest normal
original reaping. Manual action does not become normal cleanup acceptance or backpressure PASS.

Post-manual public preservation receipt `dcf1a7` reached exit 0: all 19 manifest members unchanged,
manual receipt matched, stage-before/after snapshots identical, business-start false and fences empty.
It independently matched original tool EOF and the full tool-array digest. The Native 137-file proof
remains the earlier `9a8bce` measurement; no later Native action or new Native measurement is claimed.

## Unresolved prerequisite and remaining scope

The exact exit-74 cause remains **UNRESOLVED**. Existing source diagnosis
`research/ticket41-r17-prestart-diagnosis.md` narrows the defined C control flow to failure before a
successful maintenance open, or an earlier validation/prerequisite check. This is a source inference,
not an observed failing syscall. Neither fd3 inheritance nor seccomp was established as the cause.
The consumed R17 stage must not be rerun or made unused. A future case needs its own reviewed prerequisite
resolution, fresh scope/artifacts and separate Root clearance.

R16's private NOMINAL_TWO_PROCESS_FIXTURE_PASS belongs to a different tuple; it supplies no new current-C
external backpressure acceptance. External EPIPE remains NOT IMPLEMENTED/NOT RUN. No Native
authentication, real Session, Host/FFI, production builder provenance, global launcher or product admission
is established here.

This commit adds evidence summaries only. Verification parsed and compared retained receipt objects,
hashed public manifest members and checked committed summary bytes. No runtime adapter/stager import,
test, build, compiler, probe, process observation, pidfd acquisition, signal, Native, key, Bun or GitHub
operation ran during this evidence work.
