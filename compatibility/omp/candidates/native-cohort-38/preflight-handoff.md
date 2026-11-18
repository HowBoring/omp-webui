# Isolated preflight handoff

Use the compiled candidate in `/dev/shm/omp-webui-native-compiler-v2-fvYEdK/checked` and a fresh empty profile outside the compiler tree. The Source38 `cli.ts` selects its dedicated no-operation branch only with the single application argument `--rpc-preflight`. It loads the split preflight chunk, emits `ready`, and accepts `negotiate_protocol` and `get_compatibility`. Closing stdin ends the original process after the response. [Existing one-process fixture](../../../../tests/compatibility/candidate.test.ts) · [Existing syscall fixture](../../../../scripts/trace-preflight.py)

## Exact artifact selection

| Path relative to the compiler scope | Bytes | SHA-256 |
| --- | ---: | --- |
| `vendor/omp-candidate/cli.js` | 3,286 | `c101c0a72f7b79f82a3b8545001aeb9f150dfccd712c9eca3171b7241a511dea` |
| `vendor/omp-candidate/chunk-w4rr9em9.js` | 23,668 | `111525aebf15d38209f3911431071a26ff0b94808f74b8985b630577bc1bf962` |
| `vendor/omp-candidate/rpc-wire.schema.json` | 229,463 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| `no-provider.ts` | 3,122 | `c413f208c3a0849c2b37726d05e4533144a36bf420b8ec3cbfb3fdfa28346497` |

The compiler symlink `vendor/omp-candidate/omp` points directly to `cli.js`. The CLI has five deferred source entries relative to `vendor/omp/packages/coding-agent/src`. They are `attachments/deny-network.ts`, `attachments/worker.ts`, `modes/rpc/catalog-mode.ts`, `modes/rpc/strict-mode.ts` and `cli-runtime.ts`. Preflight selects the split chunk. Use the absolute Linux x64 Bun 1.4.4 executable listed in the compiler evidence. [Exact runtime, dependency bytes and compiler receipts](compiler.md)

The report must carry these four exact fields.

```json
{
  "base": "7c49c11aa5bbaf3f418406583096168ad5b8c6dc",
  "sourceSha256": "5e9f0c1f8ae49926c4cb48dfcf6b4607dd1ab399fb0b716b50340e07a01b7c14",
  "patchSha256": "4155257edd91417311078f83ae144114c11968ef2709c27afaf72e9974e771ac",
  "schemaSha256": "81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958"
}
```

## Bounded public check

Use the current `PreflightTransport` directly. `open()` validates `ready`, enforces the 1 MiB physical and 64 MiB reassembly budgets, negotiates v2 and correlates the response. `inspect()` sends only `get_compatibility`. `close()` drains stdin and reports the original child status and both reader EOFs. The active and compiled candidate copies of the public `rpc-frame.ts` are byte-identical at SHA-256 `9592c30c7bf12660584f67860f7abd64b752aeea15d1ce58430cfa3e5795bef3`. [Public transport](../../../../packages/compatibility/transport.ts)

Give both the driver and its original child an allowlisted environment. Launch the driver with the exact no-provider guard preloaded before it imports `PreflightTransport`. Use a separate driver directory for capture files so the child profile can remain empty.

```ts
const childEnv = {
  PATH: "/usr/bin:/bin",
  HOME: profile,
  PI_CODING_AGENT_DIR: profile,
  TMPDIR: profile,
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  NODE_DISABLE_COMPILE_CACHE: "1",
};
const client = await PreflightTransport.open({
  argv: [bun, "--no-env-file", "--no-install", "--preload", guard, cli, "--rpc-preflight"],
  env: childEnv, cwd: profile, timeoutMs: 3000, readyTimeoutMs: 3000,
});
const childPid = client.processId;
const report = await (async () => {
  try {
    return await client.inspect();
  } finally {
    const drain = await client.close();
    assert.deepEqual(drain, {
      code: 0, forced: false, stderrBytes: 0, terminationSent: false, forceSent: false,
      stdoutEOF: true, stderrEOF: true,
    });
  }
})();
```

Validate the returned report with the matched `report.js`. Require both new policy objects, the four pinned identity values, `safePreflight: true`, `sessionAdmission: "blocked"`, the capabilities `safe-preflight-v1` and `rpc-framing-v2`, and Linux x64 Bun `1.4.4`. Record the original child PID and cooperative drain, the outer tool’s original EOF status, and the empty before/after profile. For the application trace, follow the driver’s original child and keep the trace outside the profile. Confirm that the preflight child opens no deferred Native entry, executes no child command, creates no profile/configuration/Session files, and dispatches no Internet-family socket activity. Recheck the compiler artifact hashes after the run. [Side-effect expectations](../../../../docs/adr/0011-diagnostic-public-preflight.md)

## Matched validators and active gate

These generated files live in `packages/contracts/generated` relative to the isolated compiler scope.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `report.js` | 38,428 | `ca136b45c2fe23459de39512db307b2265c36b01f69e7bbda08d0a5527246466` |
| `ready.js` | 45,761 | `fd3af5148ac41368d4f757af0d8c66b6a4d2f03121bb76917fa8a1e8e63c3230` |
| `response.js` | 4,327 | `093016853568e4bd2db80f63d6c58b868b6ae01104465125726853638487d87b` |
| `negotiated.js` | 1,803 | `ab465b4bcd13d4215537b98723e5f9cbd92abc4b089490bc5511278a98e82c82` |
| `command.js` | 6,515 | `7f2d0fb19862410d912885d78f21f8446d9704abed2a5b125315132af053f1bb` |

A guarded, synthetic report readback reached EOF 0 (`bcc1dd`). Both active and matched validators accepted the Source38 report with both added policies. The active validator also accepted a `null` submission policy. The matched validator rejected it. Validate the actual report with the matched copy in addition to the transport’s active structural checks. The active diagnostic gate independently requires exact source and schema identity. Against the composed report, its active patch `19821d6e2e340bcf52ee1d288f2f42a29998bc54e183c384a04557e2effb2286` and schema `ed446d360feb896fb5575ca9db5e982c31fd3aebd0cd1c4233881250e7553a1f` both mismatch. Report that refusal from the existing comparison without swapping active generated files or enrolling this candidate. [Active diagnostic gate](../../../../packages/compatibility/diagnostics.ts)
