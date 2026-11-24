# #41 R20 control read-half fault evidence

The owning control peer returned from `shutdown(SHUT_RD)` in one current-C synthetic broker and
FakeDispatcher run. The original guardian stayed live, the incomplete fence bytes stayed identical,
and the exclusive maintenance lock stayed denied in 24 samples spanning **0.250103309 seconds**
after shutdown. The fixture entered HOLD with `CONTROL_READ_HALF_FAULT_HELD`. The separately
authorized manual disposition ended with `MANUAL_DRAINED_NOT_PASS`, original tool EOF and status 2.
Product admission remains blocked. [#41](https://github.com/HowBoring/omp-webui/issues/41)

## Observed run

Root verified the held original guardian pidfd and the absence of business start before authorizing
START on the original TTY. The fixed broker exited naturally with `ROOT_EXIT <generation> 0 0`.
The fixture then filled the original socket's send queue through its retained duplicate. The actual
write reached `EAGAIN` (errno 11) after 8,128 bytes, using 4,096-byte write requests under the strict
1 MiB limit. FakeDispatcher wrote the completion ACK before the owning peer shut down its read
half. The guardian's exact write errno, ACK consumption, and COMPLETE frame timing remain unobserved.

Once in HOLD, Root separately authorized one signal through the original guardian pidfd. The guardian
was reaped with wait status -9, its stdout and stderr reached EOF and their readers joined, and the
controller's direct-child domain reached `ECHILD`. The outer runner collected the original controller's
wait status 2, stdout and stderr EOF and reader joins, and its own direct-child `ECHILD`. The adapter
excluded control socket EOF from the proof after `SHUT_RD`.

The outer journal recorded `businessDeadlineExceeded: true` for its sampled 20-second business
deadline. HOLD to the manual signal intent took about 34.59 seconds, and the business marker to final
outer disposition took about 34.91 seconds. The incomplete fence remained byte-identical after reap
and independently matched SHA256 `a87ae0093a104d3ec0afde1d63bc357e4df8a1c1b23bee91b5e239af5cae6d6b`.

The production source was `7459e233fc58c03b49b8dc1a5204bfb348e074d5`, with the four C inputs
byte-identical to the R18 inputs. R20 SourcePlan SHA256 is
`cddcf3a0781a80aaaceac7df01f4ad23a8c4f77107b6aa91aa22eb95b10a739e` and the sealed manifest SHA256 is
`0e0871d0b5a1fc68639b66bc941c17c8e3d76d1618afe667512dffb5a07a8679`. The original tool receipts and
stage journals are retained outside Git. The structured record identifies the consumed scope,
20 rehashed immutable manifest members, preserved journal digests and original tool chunks.
[Structured record](ticket-41-control-read-half-r20-actual.json)

## Earlier runs

R18 remains the nominal backpressure `PASS_DRAINED` run. R19's original stdin was `/dev/null`,
so it failed before START with `ROOT_CONTROL_EOF` and its fault case remained `NOT_RUN`.
R19's separately authorized pre-START recovery preserved its failed fence. The original R19 tool
reached EOF/137 and the recovery tool reached EOF/0. The original controller's guardian wait and
the guardian's direct-child `ECHILD` remain unattested for R19.
[R18 actual evidence](ticket-41-current-backpressure-r18-actual.md)

## Reproduce the archived source bytes

The R20 source delta copies and changes the R18 adapter and stager, adds the R20 test and source
metadata, and recreates four relative R18 donor links. Its SHA256 is
`ced23a1eb48561fb908cb052b7806e14ae68569e5ccf0f29ce2fd8821e863d7e`.
[R20 source delta](ticket-41-control-read-half-r20-source.patch)

The reviewed R18 donor patch was tracked in `78b50e6f5440a68f0c3b12b9030bbadf92045dcc` with SHA256
`a1c3e333df3eab2ae31cec67d3765d7a4917e3a113a8cf539dd90bb78e51e15a`.
[R18 donor patch](ticket-41-current-backpressure-r18-source.patch)

From the repository root, replay both historical patches in a fresh scratch directory. This reads
the archived fixture inputs and verifies source bytes without importing the adapters. The sealed
paths and generation inside the reconstructed files identify the consumed historical window.

```bash
repo=$(pwd -P)
evidence="$repo/docs/evidence"
scratch=$(mktemp -d /tmp/omp-r20-source-replay.XXXXXX)
r18="$scratch/recovery/r18-current-backpressure-source-v1"
r20="$scratch/recovery/r20-current-control-read-half-source"

git archive b38e5a69caf1de8888ef36799740d1f021fafa30 \
  tests/supervision/fixtures/external-backpressure-root.c \
  tests/supervision/fixtures/external_backpressure.py \
  tests/supervision/fixtures/external_backpressure_io.py \
  tests/supervision/fixtures/external_backpressure_policy.py \
  tests/supervision/fixtures/external_backpressure_policy_test.py \
  tests/supervision/fixtures/external_backpressure_stage.py |
  tar -x -C "$scratch"
mkdir -p "$r18"
cp "$scratch"/tests/supervision/fixtures/external* "$r18/"
git -C "$scratch" apply --unidiff-zero "$evidence/ticket-41-current-backpressure-r18-source.patch"
(cd "$r18" && sha256sum -c SHA256SUMS)
git -C "$scratch" apply --unidiff-zero "$evidence/ticket-41-control-read-half-r20-source.patch"
(cd "$r20" && sha256sum -c SHA256SUMS)
```

The replay verified all 12 R18 donor checksums and reproduced all 10 R20 entries byte for byte,
including the four symlink targets. The R20 source review recorded 13 passing pure tests. The source
plan and manifest preserve their original sealing-time `NOT_RUN` labels.
