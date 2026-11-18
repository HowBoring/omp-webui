# Isolated compiled Native preflight

The Linux x64 Bun `1.4.4` case used the unregistered Source38 launcher from the exact 12-patch compiler tuple. The only application argument was `--rpc-preflight`. The public exchange negotiated v2 and correlated `get_compatibility`. The report matched the four embedded identity fields and indicated `safePreflight: true` and `sessionAdmission: "blocked"`. [Artifact and report identity](preflight-handoff.md)

## Retained attempts

| Observation | Original tool result | Scope |
| --- | --- | --- |
| First Host transport attempt | `3f0a18`, EOF 1, `RPC_STDIN`. The expected exit audit was absent. | `/tmp/omp-webui-compiler-preflight-NPN4D9hB` |
| Direct POSIX stdio capture | `258052`, EOF 0. The original child exited 0 after stdin EOF and the output streams drained cooperatively. Guard denials and dispatches were both 0. | `/tmp/omp-webui-compiler-preflight-diag-s1vr79f9` |
| Public framing and schema readback | `0e61c7`, EOF 0. The captured output contained exactly `ready` and the two correlated replies, with the matched report schema and identity. | Same POSIX capture |
| Fresh Host transport attempt | `d1ae43`, EOF 0. The original child was PID `728040`, owned and reaped by the transport. Both readers reached EOF, stderr was empty, and the child exited 0 without forced, TERM or KILL cleanup. | `/tmp/omp-webui-compiler-preflight-wgfzfI5t` |

The fresh Host case made local IPC available to the isolated transport. The exact no-provider preload ran first, before the audit preload and launcher. The audit counted zero denials and zero dispatches. The separate synthetic HOME and working directory both remained empty. The audit receipt was written in the parent scratch directory. No original child wait, clean drain or guard result is inferred from the first attempt.

The active report validator accepted the real report and also accepted a copy with its submission policy set to `null`. The matched generated validator accepted the real report and rejected that mutation. The active diagnostic installation gate still rejects the different exact patch and schema identities. This is public launcher diagnostic evidence. The global installation, `rpc-ui` Session work, external ownership and private product admission remain pending under [the candidate admission ticket](https://github.com/HowBoring/omp-webui/issues/41).

## Source and capture identities

The portable proof sources use repository-relative Host imports and explicit scratch inputs. Both passed scoped strict TypeScript and Oxlint against integration `01522006c7c2d6cdf1a5cecaa5e25ef4dece0999`. The original sources are retained separately in the local recovery directory. The raw stdout and audit files remain in scratch.

| Tracked source | Original recovery file | Original bytes | Original SHA-256 |
| --- | --- | ---: | --- |
| [Host transport proof](preflight-transport-proof.ts) | `restore18-compiler-preflight.ts` | 5,548 | `c752d079b9408514f1cb569ff200584de84ca044c17dfadeaeb26e767b748997` |
| [Captured POSIX readback](preflight-captured-readback.ts) | `restore18-compiler-preflight-readback.ts` | 3,333 | `3b7790b0f63ae0e9d25fa57b51927bede8e8099be63fe72aa1bbd195282df3ad` |

The captured `stdout.jsonl` is 2,174 bytes with SHA-256 `3cc944b24e6edd0cb6a4d81a7b7b031b4ce6cba9a2145243c870d92c62e9c08a`. Both successful guard receipts are 27 bytes with SHA-256 `4ebfcde225764cc663096193f3a9b5f203d9b7097426d282cc4c167fa5f3c4d3`.
