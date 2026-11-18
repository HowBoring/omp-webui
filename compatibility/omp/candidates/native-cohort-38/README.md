# Native Source38 compatibility candidate

This source candidate brings together durable submission results, committed History Navigation, attachment preparation and the image Original budget from Source38. It layers the reviewed offline ModelRegistry and read-only Branch Inspection patches over that stack. The patch order and the exact tree after each patch are pinned in [candidate.json](candidate.json).

The first six patches are the existing compatibility sequence. Their bytes match Source38. The next four files reproduce the tracked Source38 patches verbatim, in their original order. The final two patches use the existing integration files for [offline ModelRegistry](../offline-model-discovery-v1/README.md) and [Branch Inspection](../branch-inspect-v1/README.md). The ModelRegistry postimage also matches that candidate’s recorded SHA-256. Source38, offline discovery and Branch Inspection each retain their own historical evidence.

## Replay

Use Python 3.9 or newer and local Git with access to OMP commit `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`. The OMP repository supplies a read-only Git object directory. Its checkout and installed dependencies are independent of replay. Use a new scratch directory outside both repositories with room for the full OMP checkout. The verified Linux replay used 274 MiB including the staged TypeScript dependencies.

```bash
python3 -B compatibility/omp/candidates/native-cohort-38/replay.py \
  /path/to/local/omp /path/to/fresh/scratch
```

Add `--verify-wire` with absolute paths to Bun, Node and a local `node_modules` containing the five package versions in the manifest. This copies the compiler and ambient types into scratch, resolves `omptype` from the replayed Native tree and preloads the pinned no-provider guard before Native imports. The verifier runs OMP’s generator, the existing one-file freshness test, artifact hash checks and a strict TypeScript check for the public wire, generator, associated callback clients and Branch Inspection handler.

```bash
python3 -B compatibility/omp/candidates/native-cohort-38/replay.py \
  /path/to/local/omp /path/to/fresh/verification-scratch \
  --verify-wire /path/to/bun /path/to/node /path/to/local/node_modules
```

The [verification record](verification.md) gives the successful individual commands, the successful independent wrapper run and the interrupted first wrapper attempt. Generated wire artifacts stay in scratch.

The [compiler-only recipe](compiler.md) uses the same replay to generate runtime validators and compile the isolated preflight launcher. The [isolated preflight evidence](preflight-evidence.md) records the actual bounded public RPC exchange and cooperative child drain. [Artifact identities and proof entrypoints](preflight-handoff.md)

The [catalog runtime recipe](catalog-runtime.md) stages the exact Linux x64 dependencies and records the public
read-only catalog exchange against a synthetic Session.

## Admission boundary

The candidate is unregistered. The active patch order, Host contracts and admission gates remain in force. The full runtime dependency and release build, external ownership composition, global launcher and platform closure, synthetic worker and TUI compatibility, and paired DSH acceptance are pending for the [candidate admission ticket](https://github.com/HowBoring/omp-webui/issues/41). Branch creation and destination publication remain part of the [durable branch ticket](https://github.com/HowBoring/omp-webui/issues/52).
