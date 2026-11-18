# ADR 0021: Stage exact originals behind current Host scope before Native preparation

- Status: Accepted source boundary; unregistered and not product acceptance
- Date: 2026-11-17
- Implements Host staging for portions of tickets 54 and 55 under ADRs 0006 and 0009

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
preparation, durable associations, draft lifecycle and product-browser admission
remain open.

An exclusive startup owner performs interrupted-write recovery before accepting
requests. Other SQLite connections join without cleaning active reservations.
This precondition does not implement a Host-process ownership lock. Ordinary
temporary failure/reopen is tested with real filesystem/SQLite; abrupt process,
power-loss and supported-platform durability acceptance remain unexecuted.

Consequences: no deduplication merges independent objects or rights; retries can
create distinct charged originals. All staged originals remain retained until
the later protected lifecycle/confirmed-deletion work exists. The Host carrier
still owes source/auth/CSRF admission, deadlines, full encoded-body and output
limits, safe download rendering and real matched Native/browser acceptance before
registering this source against private product Sessions.
