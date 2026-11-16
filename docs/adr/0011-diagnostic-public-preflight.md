# ADR 0011: Side-effect-free public candidate preflight before Session admission

- Status: Implemented for S0 diagnostics only
- Date: 2026-11-16
- Ticket: [S0 compatibility preflight](https://github.com/HowBoring/omp-webui/issues/30)

The baseline OMP CLI eagerly imports configuration, native setup and worker helpers. Its ordinary
`rpc-ui` ready frame therefore cannot prove an installation is safe to inspect before a Session exists.
The compatibility patch replaces the public entry with a thin deferred dispatcher. Only the exact
`--rpc-preflight` startup argument loads the pure public framing/report path. Every other argument
uses the same original CLI implementation, with an explicit deferred entry preserving main-process
worker setup. Dynamic imports here are an intentional exception to upstream's static-import preference:
the accepted startup safety boundary requires that configuration/Session modules are not evaluated.

`get_compatibility` is a new public command in this candidate, available only in preflight mode.
It is authored in the upstream wire DSL; the same source generates schema, TypeScript and the upstream
Python/Rust/Go artifacts. Host and server validators are generated from that schema. The S0 client only
accepts the marker-free ready/response/report/negotiation subset and two preflight commands. It explicitly
rejects unimplemented leniency markers in those selected definitions. It does not claim a full Session,
Interaction or prompt client; those capabilities and general private Session admission remain blocked.

The normal CLI is a source-mode Bun installation, deferred from the compiled preflight launcher.
Its exact source tree, launcher, runtime and frozen dependency/native assets are included in the trust
manifest. This is an isolated compatibility candidate for development; it is not a secretly installed
production worker or proof of the user's global installation. A future real global installation must
be explicitly enrolled and satisfy the same content checks, plus installation stability/security gates.

The operator selects a manifest and launcher in Host startup configuration. Enrollment is a separate
build-time action, never a startup/request fallback. Hashes identify reviewed inputs; they do not
self-authenticate their publisher. Verification covers modes, directory membership, source, executable
contents, direct symlinks and runtime/dependency assets. Indirect links and symlinked ancestors are
rejected instead of claiming an incomplete closure. Checks occur before and after the actual child;
these checks do not prove atomic installation immutability. That future gate remains explicit.

The Host starts preflight with an absolute verified Bun target, `--no-env-file`, a controlled temporary
cwd and only synthetic HOME/profile/TMPDIR environment values. It drains and reaps the child and rejects
terminal corruption/nonzero/forced exits. Raw stderr is discarded; only its bounded byte count exists.
The actual DSH Connection, mounted strict Remote, Gateway invocation, Peer and Gateway `$events` stream
run on Bun. The shell mounts no Session/Workspace/Agent controller. Only sanitized identities and
blocked capabilities reach the loopback page; private APIs return 501. Same-origin/Host checks precede
body parsing or dispatch. Authentication and private Session authorization are later gates.

Linux is the current implementation and validation scope. Per the owner's explicit direction, actual
Windows/WSL2 acceptance is deferred until development completes and the owner switches environments.
