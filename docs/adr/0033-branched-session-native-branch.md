# ADR 0033 — Branched Session through the public Native branch command

- Status — Source component for [#52](https://github.com/HowBoring/omp-webui/issues/52). Host registration and product acceptance are pending.

A Branched Session is a new Native Session created from a historical user point.
[CONTEXT.md](../CONTEXT.md) keeps it distinct from History Navigation, which
moves the current Session's leaf, and from copying a conversation. The Chat Host
already supervises exactly one Native worker per Session, so the branch is one
Native action against the supervised worker, then a verified replacement of the
presentation.

## Decision

The Host uses the public OMP v2 `branch` command and nothing else.

1. `branchPoints` reads the Native allow-list (`get_branch_messages`) for the
   current worker generation. Rendering and selection never infer branchability
   from an entry's role, text or position. An unchanged presented cut may answer
   from the last Native response of that generation; a new journal, cut or
   generation drops it, so the allow-list is never older than the shown Session.
2. `branch` revalidates Browser authority, the exact worker and generation, the
   native target membership, native quiescence and current interaction deadlines.
   A busy Session fails with `SESSION_WORKER_BUSY_STOP_REQUIRED`; the Host neither
   stops nor queues the branch, and the person re-initiates it after the stop.
3. Native cuts at the selected entry's actual parent, keeps the root→parent path
   only, mints a new Session identity and switches the worker. The selected entry,
   the rest of the path and every sibling stay in the source Session. Returned
   text is a draft; the Host never sends it, never replays it and never calls a
   model.
4. The Host verifies the result before showing it: the new Session ID and file
   differ from the source, the catalog descriptor's `parentSession` is the exact
   previously observed source file, the working directory is unchanged, and the
   destination tree holds exactly the source conversation ancestors of the cut.
   Anything else is unconfirmed or mismatched, and the view is not replaced.
5. Only after verification does the Host retire the source worker and open the
   new Session through the ordinary durable open path. Replacement is atomic:
   the old worker ID, generation, projection, journal epoch, tree and pending
   attempt belong to the previous Session and cannot publish into the new one.
   A lost native reply keeps the recorded outcome `unknown` and the person opens
   the Session list; nothing is replayed.
6. Files and external effects are never rolled back. The confirmation and the
   result say so, and returned text lands in the composer as an unsent draft.

## Consequences

- Native Session files, identity and lineage stay OMP's. The Host stores no
  transcript copy and parses no session file.
- The strict-continuation guard needed one narrow relaxation
  (`compatibility/omp/0012-strict-branch-transition.patch`): the branch transition
  uses the same durable native file publication as the durable submission path
  instead of being forbidden. Every other strict alternate-target transition
  stays forbidden, and the file remains published by the native reservation
  primitives rather than by Host code.
- The branch reply is text-only, so attachments in the selected message are not
  carried by the Host; the returned draft says it is text, and attachment
  Originals are recovered through [#56](https://github.com/HowBoring/omp-webui/issues/56).
- The source Session keeps its own identity and remains openable, so later
  attachment association for either side has a Native source to point at.
