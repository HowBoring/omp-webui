# Source38 native TUI after committed History Navigation

On Linux x64 with the staged Source38 CLI and Bun 1.4.4, the normal native TUI reopened a
synthetic Session after a protected public RPC navigation. This covers the ordinary clean-exit
path for [History Navigation #37](https://github.com/HowBoring/omp-webui/issues/37) and one
native TUI case for [candidate admission #41](https://github.com/HowBoring/omp-webui/issues/41).

The public Catalog selected one synthetic Session. The StrictStart worker negotiated RPC v2,
continued the Session and committed navigation to `tui-rewound-user` with summaries disabled.
The terminal receipt and a fresh History tree agreed that `tui-retained-user` was the active
leaf. The rewound entry remained in the tree as inactive. A read-only query in the same worker
returned the exact terminal receipt. Both RPC processes closed through stdin EOF and reached
stdout and stderr EOF with exit 0 and empty stderr.

The normal CLI opened the same protected carrier with `--session` in an isolated PTY. It reached
idle, rendered `Synthetic TUI retained input` and omitted `Synthetic TUI rewound input`. The
only key sent was Ctrl+D. The TUI printed the resume hint for the same Session ID and reached
PTY EOF with exit 0 and no signal. All three pre-import guard audits recorded zero network
denials and zero dispatches.

The protected carrier, generation, control metadata and their directories kept the same paths,
inodes, sizes, modification times and change times across the TUI open and exit. The three file
hashes and carrier extended attributes matched before and after. The fixture working directory
was empty at both checks.

## Evidence

Run `46eca1`, session `83554`, reached EOF 0. Its 6,477-byte sanitized result is retained at
`/dev/shm/omp-source38-native-tui-run.60BV5rFt/output/result.json` with SHA-256
`35463c3701cd2f36576d12c63dba602f3444ecb49f57431467f2cead0f3db7a6`. Independent readback
matched the source pins, terminal navigation and TUI facts, all three raw guard audits and the
retained protected file fingerprint.

| Input | Identity |
| --- | --- |
| Host integration commit | `263f8cfffd2db1437d877ab67c4f10984faac1f1` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| Complete StrictStart stage receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Staged CLI SHA-256 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| Bun executable SHA-256 | `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |
| Pre-import guard SHA-256 | `c413f208c3a0849c2b37726d05e4533144a36bf420b8ec3cbfb3fdfa28346497` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |

The reviewed inputs under `/dev/shm/omp-source38-native-tui-proof.v8FD8Dea` were
`prove-tui.ts` (SHA-256 `36b60c05564db224e0bfa8fd5faa8dcd6a61a2938daeaf55aecb338ad1e4a455`)
and `tui-render.py` (SHA-256 `d228c51bd4ae85717ac94af1552b94ce75b8676de12cd86e0874301ad9ac191e`).
The PTY probe used Python 3.12, Pexpect 4.9.0 and ptyprocess 0.7.0.

Baseline and rollback compatibility, native TUI writes, abrupt exit, DSH Browser acceptance and
global installation still need separate evidence. The candidate remains unregistered.
[StrictStart staging](strict-runtime.md) · [Public RPC clean reopen](navigation-runtime.md)
