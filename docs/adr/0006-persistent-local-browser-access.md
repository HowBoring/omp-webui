# ADR 0006: Remember local browser access and manage directory grants in the WebUI

- Status: Accepted policy; authentication, grant operations and validation unimplemented
- Date: 2026-11-15
- Decision: [原生目录与历史导入的本地访问安全边界](https://github.com/HowBoring/omp-webui/issues/20)

The single-user loopback MVP remembers browser authorization for 30 days across Host restarts when
the Host data directory and access origin remain the same. It provides current-browser logout and
revocation of all browser credentials. Durable authorization state is private Host-owned data,
separate from OMP provider credentials and native conversations. Restarting a worker or restoring
its interactions is not implied by remembering a browser credential.

The authenticated owner can explicitly grant a canonical working-directory root and its descendants
in the WebUI, persist that grant, and revoke it. Ordinary discovery or Session opening never grants
new rights. This supersedes a configuration-only working-directory proposal; Session discovery
sources still follow the selected OMP profile and locally configured custom Session directories.

Uploads use a dedicated configured staging area and validated receipts/object identities. The
upload operation does not select a destination path or overwrite project files. Attachment formats,
retention and history retrieval remain a separate contract; permanent attachment storage is not
approved by this policy.

These choices trade persistent local authorization material and explicit WebUI grant administration
for fewer login and directory-configuration steps. Every operation still requires current credential,
request-source and resource checks. The [local access contract](../local-access-contract.md) defines
those boundaries. Host admission controls do not sandbox OMP tools or contain malicious local code
running with the same operating-system privileges.

## Isolated implementation evidence (2026-11-16)

Ticket #42 implements the persistent browser authority; ticket #43 adds canonical directory preview, explicit
confirmation, persistent revoke and current-rights readonly catalog/Session Index metadata mapping in an isolated
authenticated acceptance executable. See [the component evidence](../evidence/ticket-43-workspaces.md).
The ordinary Host still denies private Session capabilities. Product composition waits for #41's combined/global
admission gates and #44's registration/protected open and supervised worker revocation; this evidence changes no
Session Source scope and does not claim those future capabilities.
