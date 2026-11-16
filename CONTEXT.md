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

**Discovered Session**:
An existing OMP Session found in a configured Session Source; discovery alone does not register or open it.
_Avoid_: Imported Session, active conversation

**Session Source**:
A configured source of native OMP conversations within a selected OMP configuration.
_Avoid_: Workspace, transcript store

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

**Session Tree**:
The branching history within one OMP Session, including its active path and other historical paths.
_Avoid_: Workspace list, chronological transcript

**History Navigation**:
Changing the active history point within the same OMP Session.
_Avoid_: New conversation, filesystem rollback

**Branched Session**:
A new OMP Session created from a historical user-message point in another Session.
_Avoid_: History Navigation, copy of the whole conversation

**Interaction**:
A pending request for an explicit user answer, such as approval or an ask dialog.
_Avoid_: Notification, automatic consent

**Attachment Original**:
The exact image or file content the user supplied, distinct from a representation prepared for a model.
_Avoid_: Model input, upload receipt

**Attachment Model Input**:
The representation of an attachment OMP includes in a model request, which may differ from its original.
_Avoid_: Original file, complete-file ingestion

**Sent Attachment**:
An Attachment Original confirmed as associated with a committed user input in an OMP Session.
_Avoid_: Uploaded attachment, prompt acknowledgement
