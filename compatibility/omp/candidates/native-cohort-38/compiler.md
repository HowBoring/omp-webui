# Isolated Native compiler evidence

[compile-candidate.py](compile-candidate.py) reads and hashes ten files at the pinned Source38 Host commit. It replays the exact 12-patch tree from [candidate.json](candidate.json). The scratch copy of `omp-source.ts` verifies the two added patches and their authored paths. The actual Source38 `--wire-only` recipe generates the wire, SDK files and standalone Host and Native validators. A fresh Bun process runs the original launcher `Bun.build` block after generation completes. The only dependency links point to packages inside the scratch Native checkout. The six compiler dependencies are copied from a local `node_modules`. [Compiler input manifest](compiler-inputs.json)

```bash
python3 -B compatibility/omp/candidates/native-cohort-38/compile-candidate.py \
  /path/to/local/omp /path/to/local/source38-host /path/to/new/scratch \
  /path/to/bun /path/to/local/node_modules
```

The first isolated attempt reached Bun’s launcher build in the same process as generation. It failed to resolve `./preflight.generated` from `preflight.ts`, although the generated file existed and contained the selected identity. Session `36228` reached EOF with exit 1 (`0c3f1c` to `8ebb29`). Its scratch remains under `/dev/shm/omp-webui-native-compiler-SNyHEn/checked`.

The separate-process attempt reached EOF with exit 0 in session `34589` (`8624d5` to `c1ce92`). The guard recorded zero denials and dispatches after both phases. Readback rechecked the staged Native tree and all five canonical wire hashes, compared the two schema objects, found the four report identity values in the split bundle, and resolved five deferred Native source paths. Twenty-three standalone Native validator files were emitted. Twenty-one are byte-identical to their Host copies. The interaction policy and result validators were generated in separate calls and differ only in generated identifiers. The actual launcher preflight was observed separately. [Isolated preflight evidence](preflight-evidence.md)

The successful scope is `/dev/shm/omp-webui-native-compiler-v2-fvYEdK/checked`. `compiler-receipt.json` is 6,232 bytes with SHA-256 `f6fe0fbaa86d596da52df2de94c4f1d8b4af404f1c343c222fcad3faf017ded6`. The receipt identifies the launcher and all 23 Native validators. The launcher symlink `vendor/omp-candidate/omp` points to `cli.js`. [Artifact identities and preflight handoff](preflight-handoff.md)

The Linux x64 Bun 1.4.4 executable was `/workspace/work/tooling/node_modules/bun/bin/bun.exe`, 107,308,936 bytes, SHA-256 `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`. Both compiler processes ran with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` and `NODE_DISABLE_COMPILE_CACHE=1`, and loaded the 3,122-byte exact no-provider preload with SHA-256 `c413f208c3a0849c2b37726d05e4533144a36bf420b8ec3cbfb3fdfa28346497` before any Native import.

The package tree hashes cover sorted file paths relative to each package, each followed by a NUL and the raw SHA-256 of its contents. The workspace dependencies `pi-coding-agent`, `pi-utils` and `omptype` resolve to the pinned Native source tree.

| Copied package | Version | Files | Tree SHA-256 |
| --- | --- | --- | --- |
| `ajv` | 8.17.1 | 466 | `d76528d0eb29ba3edfc02622ee3d65ef45c6550be33f417cef42ee32e672392d` |
| `fast-deep-equal` | 3.1.3 | 11 | `e6023659292983af97a84b41ae18378a8c062262868c638b890e5db1d33002cb` |
| `fast-uri` | 3.1.9 | 47 | `a8ca5092800cd3afa3d1891fe2a2305abf66edf4de3c4438eb0f17774b4c6a00` |
| `json-schema-traverse` | 1.0.0 | 12 | `17bdb7bcb1cda3a7af54d5147bb5cd9c70677eebaced95cc354b15ae2d32cac1` |
| `require-from-string` | 2.0.2 | 4 | `b49e7d15e5a8500bee8b145a1e08657522604e4030bf243a958556c0ca6f105a` |
| `zod` | 4.6.6 | 840 | `e84d4f6e178291c24d399cf7d35b54b98f91f9ce69c70d16a03393db4aeaac45` |
