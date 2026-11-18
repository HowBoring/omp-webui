# Ticket 45 and 46 DSH source composition

The [dormant source manifest](../../compatibility/dsh/chat-and-tool-source-candidate.json)
pins DSH `38a6a5c965aa99ab525161efb7cc5cf1fe62fced` and seven ordered patches.
The reconstructed tree is `e011120c10c66dc067e2787054d21b52b2a15de1`.
The active manifest used by `scripts/dsh-source.ts` still lists only patches 1–3.

Patches 1–5 have identical bytes in both donors and integration. The sixth patch is
the existing parsed Tool proposal, which projects parsed arguments into typed
Conversation records and inert JSON while preserving the legacy raw argument string.
The seventh patch is the byte-for-byte notice patch from Source45 `54545e6`, with a
new sequence number. Its existing `PromptError.submission` and `reconcilePromptError`
seam correlates the Session, request, original projection and invocation attempt.
It clears only the associated send notice when the caller has exact accepted or
completed-without-input evidence. It leaves provider failure presentation and the
newer editable draft in place. The patches touch 25 and five disjoint paths respectively.
[Tracked notice patch](../../compatibility/dsh/patches/0007-prompt-notice-reconciliation.patch)
[Parsed Tool source evidence](ticket-46-parsed-source-candidate.md)

## Reproduce the source check

From the Host repository root, set `DSH_READONLY_OBJECTS` to the absolute Git objects
directory of an existing DSH checkout containing the base commit. The commands use
Git, Bash, and `jq`. The temporary index and new objects live in a scratch repository
with the existing objects as a read-only alternate. Use integration history containing
`0ce71bffe2db2bd0a19cdf02d72af41a26abbcfb`. The tracked hashes and DSH objects suffice
for replay. Historical donor commits, when present locally, add byte comparisons.

```bash
(
  set -euo pipefail
  dir="$PWD/compatibility/dsh"
  candidate="$dir/chat-and-tool-source-candidate.json"
  source45=$(jq -er '.donors.promptNotices.hostCommit' "$candidate")
  source46=$(jq -er '.donors.parsedTools.hostCommit' "$candidate")
  integration=$(jq -er '.integrationBase' "$candidate")
  parsed="$dir/patches/0006-parsed-tool-presentation.patch"
  notice="$dir/patches/0007-prompt-notice-reconciliation.patch"
  for path in compatibility/dsh/patches.json compatibility/dsh/parsed-tool-source-candidate.json upstreams.lock.json; do
    git show "$integration:$path" | cmp - "$path"
  done
  for file in "$dir"/patches/000[1-6]-*.patch; do
    path="compatibility/dsh/patches/${file##*/}"
    git show "$integration:$path" | cmp - "$file"
  done
  compare_local_donor() {
    local donor=$1 donor_patch=$2 tracked_patch=$3 file path
    if ! git cat-file -e "$donor^{commit}" 2>/dev/null; then
      printf 'Local donor byte comparison skipped for %s\n' "$donor"
      return
    fi
    for file in "$dir"/patches/000[1-5]-*.patch; do
      path="compatibility/dsh/patches/${file##*/}"
      git show "$donor:$path" | cmp - "$file"
    done
    git show "$donor:$donor_patch" | cmp - "$tracked_patch"
    printf 'Local donor patch bytes verified for %s\n' "$donor"
  }
  notice_path=$(jq -er '.donors.promptNotices.patch' "$candidate")
  compare_local_donor "$source45" "$notice_path" "$notice"
  compare_local_donor "$source46" "compatibility/dsh/patches/${parsed##*/}" "$parsed"
  jq -e --slurpfile active "$dir/patches.json" \
    --slurpfile parsed_only "$dir/parsed-tool-source-candidate.json" \
    '(.sourceManifest | .patches = .patches[:3]) == $active[0]
      and (.sourceManifest | .patches = .patches[:6]) == $parsed_only[0].sourceManifest' "$candidate" >/dev/null
  digest=$(jq -cj '.sourceManifest | {base: .baseCommit, sourceTree: .patches[-1].treeAfter, patches}' \
    "$candidate" | sha256sum | cut -d ' ' -f 1)
  test "$digest" = "$(jq -er '.sourceSha256' "$candidate")"

  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' EXIT
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  git init --quiet "$scratch/dsh"
  export GIT_INDEX_FILE="$scratch/index"
  export GIT_ALTERNATE_OBJECT_DIRECTORIES="${DSH_READONLY_OBJECTS:?Set DSH_READONLY_OBJECTS}"
  dsh() { git -C "$scratch/dsh" -c core.autocrlf=false "$@"; }
  apply_patch() { dsh apply --cached --whitespace=error "$1"; }
  base=$(jq -er '.sourceManifest.baseCommit' "$candidate")
  test "$base" = "$(jq -er '.dsh.commit' upstreams.lock.json)"
  test "$(dsh rev-parse "$base^{tree}")" = "$(jq -er '.sourceManifest.baseTree' "$candidate")"
  dsh read-tree "$base"
  jq -er '.sourceManifest.patches[] | [.path, .sha256, .treeAfter] | @tsv' "$candidate" > "$scratch/patches"
  while IFS=$'\t' read -r path sha tree; do
    printf '%s  %s\n' "$sha" "$dir/$path" | sha256sum --check --status
    apply_patch "$dir/$path"
    test "$(dsh write-tree)" = "$tree"
    printf '%s %s\n' "$path" "$tree"
  done < "$scratch/patches"
  combined=$(dsh write-tree)
  shared=$(jq -er '.sourceManifest.patches[4].treeAfter' "$candidate")
  parsed_tree=$(jq -er '.donors.parsedTools.sourceTree' "$candidate")
  notice_tree=$(jq -er '.donors.promptNotices.sourceTree' "$candidate")

  dsh read-tree "$shared"
  apply_patch "$notice"
  test "$(dsh write-tree)" = "$notice_tree"
  apply_patch "$parsed"
  test "$(dsh write-tree)" = "$combined"
  dsh apply --cached --reverse --whitespace=error "$parsed"
  test "$(dsh write-tree)" = "$notice_tree"
  dsh read-tree "$combined"
  dsh apply --cached --reverse --whitespace=error "$notice"
  test "$(dsh write-tree)" = "$parsed_tree"
  printf 'Both application orders and donor trees verified: %s\n' "$combined"
)
```

Git 2.52.0 verified all seven intermediate trees, both postimages, and the reverse
deltas with and without the historical Host donor objects. The parsed-only tree
`2440ab8cdd85b85013aff36d3af60edb1b311e27` failed to
reverse-apply the notice patch. The notice-only tree `ff9cb83a99a9b969057ca74771210c66d67f5df5`
failed to reverse-apply the parsed Tool patch. These are source checks. The patches
retain their original hunks, so this slice adds no behavioral fixture.

## Artifact and runtime evidence

The earlier isolated Linux browser proof used Source45's patches 1–5 plus the notice
patch, the V2 client installation SHA-256
`dcc504f535c8d8942a9332b7307a4f8130695958ca3c4c01a7652fbffb018c62`, and a controlled
Native ModelRegistry source overlay. The overlay changed the file SHA-256 from
`c33502eef8a0931889bdaab2a28da23c64b531b1241d4fbcf816a0d507d434f7` to
`4170d9c10d12626e0bc2833282f120529b66a6b5ee5ed129309723baaa4327f5`.
One explicit send reached one controlled provider call and visible failed settlement.
The unresolved send notice was absent, the draft stayed editable, and the one-second
observation found no retry or additional Native input. The original catalog and worker
exited 0, both readers reached EOF, and the retained wait domain reached ECHILD. The guard
reported zero denials or dispatches and the Native traces had zero Internet-family calls.
[Tracked offline candidate evidence](../../compatibility/omp/candidates/offline-model-discovery-v1/evidence.json)

The raw receipts are local to the historical checkout at
`omp-webui-ticket-45/vendor/chat-evidence/provider-error-restore18-offline-startup-v1/`.

| Local file | Verified SHA-256 |
| --- | --- |
| `provider-error.json` | `545ec10201d7c4dc577070597531d20e2ea28666fda8017bd372df62eca687a5` |
| `original-retainer.json` | `5813bd00094321b03848716173a5bc775ce491ba5d816e3124cb82bf7805cdab` |

The prior artifact readback describes the notice-only DSH source SHA-256
`23524489262ef157efbf34705bebc67f1cb26f6c8cb4038a10fa9ef487c00675`. The older default
DSH package links remain historical artifacts. The existing draft fixture needs public
Client source exports such as `DraftTabOwner`. The linked `ui-conversation/lib/client.js`
has a CommonJS assignment for that symbol under a `type: module` package and produced
a missing named export in the integration fixture.

The combined tree has no matched build or browser proof. Whole-source typecheck,
upstream persistence catalog generation and acknowledgement, bilingual pairing and
complete consumer checks remain pending. `tool/parsed-call` remains unadmitted and
no Native ownership or reopen evidence exists for it in this cohort. The broader
ticket 45 send, refresh, multi-view, reconnect and failure matrix still needs evidence
from one matched combination. Tickets 29, 45 and 46 remain open and private Session
admission remains blocked.
