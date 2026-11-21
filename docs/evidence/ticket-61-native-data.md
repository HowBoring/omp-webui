# Ticket 61 — native data, TUI, upgrade and current-data rollback

Harness: `tests/continuation/native-data.py` → `docs/evidence/ticket-61-native-data.json`.
Data: isolated synthetic native Sessions written under a throwaway `HOME` matching
`navigation-*`; **no real user history was opened, migrated or rewritten**. The TUI is a real PTY
(`pexpect`, 40×160) driving the real binary; the provider is the controlled fixture
`compatibility/omp/fixtures/navigation-provider.ts` behind the `no-provider.ts` preload guard, so no
real inference happens.

| Check | Status | What it proves |
|---|---|---|
| `currentCreatesNativeData` | PASS | The current build (`vendor/omp-candidate/cli.js`, base `57771ae5`, runtime `19.0.0`) writes a native Session: header `version:3`, `network` audit `denied` with `actualNetworkDispatches: 0`. |
| `currentTuiReopensCurrentData` | PASS | A real TUI term renders the file: prompt and `literal fixture response` visible, exit 0, only `custom:session_exit 19.0.0` appended. |
| `previousBuildOpensCurrentData` | PASS | The pinned previous build `@oh-my-pi/pi-coding-agent@18.20.2` (`dist/cli.js` sha256 `648be0034d37318687525546dcbef0bd1596dda87d008cc14fecc801c821ac76`) opens a **copy** of current data, renders history and writes only its own exit marker. Resolution: `lossless-resume`. |
| `previousBuildCreatesBaseData` | PASS | The previous build creates its own native Session in the same isolated profile. |
| `currentUpgradesPreviousData` | PASS | The current build resumes previous-build history, continues one turn and appends `message`/`custom:system-prompt-digest`/`message`/`custom:session_exit` records of its own; all 18.20.2 records remain a byte-identical prefix. `newMetadata.formatUnchanged: true` — the header stays `version:3`. |
| `previousBuildRollsBackUpgradedData` | PASS | After that upgrade, 18.20.2 still opens the file, renders both turns and appends only its own exit marker. Resolution: `lossless-resume`. |

## What "previous build" means here

`upstreams.lock.json` pins the reviewed baseline at `18.20.2` / commit `7c49c11`, and the registry
serves that exact version, so the pinned tarball installed in `vendor/omp-previous/` **is** the
previous build; it is not a hand-built approximation and it is recorded with its launcher digest in
`docs/evidence/ticket-61-freeze.json`.

## Limits

* Native data is synthetic and isolated; the migration/upgrade paths are therefore proven for the
  record formats exercised by the fixture, not for every historical OMP record shape.
* A session file gains a `custom:session_exit` record whenever any TUI exits, so "unchanged" is
  asserted as **append-only**: readers must not expect byte equality after a TUI visit.
* The controlled provider refuses any `HOME` that does not contain `navigation-`
  (`synthetic_navigation_profile_required`) and the TUI only reaches
  `\x1b]7501;state=idle:app=omp` when `--model navigation-controlled/literal` is passed; without it
  a "Select provider to login" overlay blocks the prompt.
* Binary rollback is validated against preserved build artifacts; it is not an automatic downgrade
  path. An incompatible installation must block admission instead (story 80,
  `docs/evidence/ticket-58-*.json`).
