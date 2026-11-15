# OMP WebUI

A browser interface for the owner's OMP conversations. This context distinguishes
the conversation itself from its browser presentation and from an active execution.

## Language

**OMP Session**:
A durable conversation with its messages, tool history and branches.
_Avoid_: Browser session, transcript copy

**WebUI-managed Session**:
An OMP Session registered in the WebUI's managed conversation set, whether created here
or imported from an existing OMP/TUI conversation.
_Avoid_: Separate WebUI transcript

**Imported Session**:
An existing OMP Session registered for WebUI access while retaining its native conversation identity.
_Avoid_: Transcript copy, new conversation

**Workspace**:
A registered working directory and the WebUI-managed Sessions associated with it.
_Avoid_: OMP Session, browser tab

**Session Index**:
The catalog that identifies WebUI-managed Sessions and the Workspace each belongs to.
_Avoid_: Chat log, OMP history

**Browser View**:
A browser's presentation of an OMP Session; reopening the view does not create a new conversation.
_Avoid_: OMP Session, worker

**RPC Worker**:
The running OMP instance responsible for an active Session's execution.
_Avoid_: Browser tab, DSH Agent

**Session Recovery**:
Returning to an existing conversation and its authoritative history.
_Avoid_: New conversation, prompt replay

**Interaction**:
A pending request for an explicit user answer, such as approval or an ask dialog.
_Avoid_: Notification, automatic consent
