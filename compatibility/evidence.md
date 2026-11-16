# Ticket #30 vertical evidence

2026-11-16, Linux x64. Integration base verified `0a0e443636d46d20a21a02de028edae4ac6ba59f`.

1. Installation seam RED: `bun test tests/compatibility/preflight.test.ts` → missing installation module (0 pass, 1 fail).
   GREEN after public `inspectInstallation` implementation → 1 pass. Unknown manifest/launcher fails before spawn.

2. Public framing RED: missing PhysicalFrames module; GREEN: matched public RpcFrameDecoder reassembles
   an actual RpcFrameEncoder v2 1.2-MiB UTF-8 response across 1337-byte reads.
3. Candidate startup RED: candidate output absent (process write failed); GREEN after actual source patch/build:
   `bun test tests/compatibility/candidate.test.ts` → 1 pass / 5 assertions, real v2 negotiation/report,
   empty isolated HOME/profile, empty stderr. Ordinary deferred CLI `--version` returned `omp/18.20.2`.
4. Public transport RED: missing PreflightTransport module; GREEN after process implementation:
   actual candidate report and observed exit0/EOF drain. Contract fixtures separately cover out-of-order,
   wrong IDs/commands, malformed results, duplicate/UTF-8/partial EOF tails, timeout/late frames,
   bounded cancellation, reap and stderr redaction. 16 compatibility tests / 29 assertions pass.
   Early tail-fixture failure was its parsing of an empty console EOF line; corrected fixture exercises real tail bytes.

Foundation checkpoint, not ticket completion: genuine typed DSH browser integration, complete clean-source
reproduction/install enrollment, expanded mutation/framing faults, and final matched evidence remain in progress.
The candidate is diagnostic-only and never grants product Session admission.
