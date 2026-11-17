# ADR 0022: Persist references and supervise one explicitly opened native worker

- Status: Isolated S1 component; normal private Session admission remains closed
- Ticket: #44
- Date: 2026-11-16

The Host persists a bounded metadata-only Session Index and reserves one worker
slot before asynchronous open work. The first explicit Open registers the selected
native source/instance/ID before revalidation; refusal retains that reference and
reason. Discovery, construction, browser refresh and Host restart do not create or
open native Sessions. A lost result stays unknown until a manual public state
observation or manual Open establishes a fact. There is no automatic replay.

Strict native startup owns exact-instance reservation and final ownership. The
Host checks the public returned binding and actual cwd; it does not reproduce
native storage interpretation or parse Session files. The combined RPC adapter
uses the same authored strict/Interaction/history schemas. Root Interactions can
therefore precede final Session binding without fabricating a DSH Session.

One active native Session has one RPC worker and any number of authorized views.
Different Session switches and explicit New are separate actions. A busy worker
or pending UI refuses New/Switch until Stop, proven quiescence and a fresh action.
Same-Session warm views remain available while busy. Confirmed-idle retirement uses
graceful EOF without background signal timers; an unconfirmed exit retains the
owned handle/generation and blocks replacement pending explicit #48 force policy. New exposes its
identity only after genuine native confirmation. Actual DSH controller/Conversation
presentation is a disposable read-only public native cut with `not_attested`
recoverability, independent of registration persistence.

Current login, effective directory grants, target directory object and generation
are checked at each entry and after asynchronous work. Logout withdraws only that
credential. Trusted revoke-all, lost effective root authorization and Host shutdown
close worker admission immediately and use one absolute 30+5-second execution
shutdown budget. Queue/UI cancellation acknowledgements, native settlement,
protocol EOF tail and child exit are recorded separately. The carrier's optional
drain policy leaves existing preflight/catalog/default shutdown behavior unchanged.
Only stored owned process handles are signalled; external lease owners and
arbitrary browser PIDs never enter process control.

General extension-descendant containment, ordinary Stop/force UI, prompt submission,
full projection rebuilding and the final production compatibility gate remain
separate component obligations. The isolated fixture cannot unlock those gates.

Source reconciliation renumbers this authored decision from 0015 to 0022 because
0015 is already assigned to retained execution/projection replacement. Historical
checkpoint manifests retain their original input path and hash; they are not current
source manifests. The supervised Session component remains unregistered and cannot
authorize production admission or an automatic direct-child cleanup fallback.
