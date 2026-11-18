# ADR 0021: Stage exact originals behind current Host scope before Native preparation

- Status: Accepted source boundary; unregistered and not product acceptance
- Date: 2026-11-17
- Implements Host staging for portions of tickets 54 and 55 and staged Original lifecycle
  for portions of ticket 58 under ADRs 0006 and 0009

The Host needs exact originals independent from Native model representations.
Staging may proceed for an explicitly opened verified Session, including while
busy, but cannot imply a prepared receipt, a queued send or a committed Native
input. Native public preparation and durable association remain gated capabilities.

Use a dedicated private filesystem root and SQLite FULL transactions for minimal
original metadata and atomic payload reservations. Reserve declared original
bytes before consuming the body; rename rather than copy at publication. Count
pending and failed-cleanup temporary payloads until physical reclamation succeeds.
The defaults are 10 MiB per image, 5 MiB per UTF-8 text or document, 8 objects
and 32 MiB per draft, and 10 GiB across the store. All media share the same draft
and store limits, including the row and in-flight caps. Full storage refuses new
intake without evicting originals. A derived sink must use the same ledger.

The trusted Host authorizer supplies current browser/page, directory, exact
profile/source/instance/Session and draft identity plus an authority epoch. Store
operations recheck it through the public intake seam; object IDs/hashes do not
provide authority. Browser filenames are display metadata, never destinations.
The proposed opt-in typed Host Remote uses the actual DSH public Gateway and a
separate raw-stream Host port. Neither claims an existing Native ingestion API.

Published metadata reports `staged-unprepared` and `unassociated`. Validation
reports `utf8-only` for text or `signature-only` for images and documents. The
Host checks a PDF or ZIP prefix and leaves package identity, parsing, conversion,
and degradation reporting to Native preparation. Native decode/model/RPC
preparation, durable associations, draft hydration and product-browser admission
remain open.

An exclusive startup owner performs interrupted-write recovery before accepting
requests. Other SQLite connections join without cleaning active reservations.
This precondition does not implement a Host-process ownership lock. Ordinary
temporary failure/reopen is tested with real filesystem/SQLite; abrupt process,
power-loss and supported-platform durability acceptance remain unexecuted.

Each Original stores its last authorized draft activity separately from its
intake timestamp. Initial activity is recorded with publication. The prior
schema's stored timestamp initializes existing rows during migration. An
explicit edit or active recovery can renew exact Original IDs in the current
draft before their 24-hour deadline. A Host collector can mark eligible rows
in bounded batches. Reads and background hydration leave activity unchanged.

Both collection and confirmed deletion require a trusted unreferenced
determination for the exact object and its complete persisted binding. The gate
must coordinate reference admission with removal commits across connections.
Absent evidence and known occupied, executing, unresolved or Native-associated
objects remain protected. Manual confirmation is scoped, short-lived and
single-use. A changed protection revision requires a fresh impact review.
Logical removal commits before unlink, and disk accounting clears after unlink
and directory sync. An in-progress Store payload read holds a SQLite read lock
until its descriptor closes. A configured gate restricts staged reads to current
unreferenced Originals. Exclusive startup checks the full payload inventory before
retrying interrupted physical cleanup.

Independent objects retain independent rights and accounting even if their
bytes match. Retries can create distinct charged Originals. Product use still
requires the #56 Native association and reference-admission coordinator, #57
draft integration, the authenticated carrier, safe download rendering and real
matched Native/browser acceptance.
