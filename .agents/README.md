# Project skills

Matt Pocock's 27 Engineering and Productivity skills are installed for Codex in
`.agents/skills/`. The skill files and their supporting references are committed,
so a fresh checkout carries the same installation.

- Source: [mattpocock/skills](https://github.com/mattpocock/skills)
- Revision: `5863806dd4e15c63174bee4e7515a4256792ecfa`
- Installer: `skills@1.8.1`, project scope, Codex, copy mode
- Installation lock: [`skills-lock.json`](../skills-lock.json), including content hashes
- License: [MIT, Matt Pocock](MATT-POCOCK-LICENSE)

The installed groups contain 20 Engineering and 7 Productivity skills. Experimental,
miscellaneous and deprecated groups are outside this installation.

## Use

Open Codex in this repository so it discovers `.agents/skills/`. In a new session,
invoke a skill by name, for example `$ask-matt`, `$grill-with-docs`, `$tdd`,
`$implement`, or `$code-review`.

Before using issue-driven workflows, invoke `$setup-matt-pocock-skills` to choose
the issue tracker and triage vocabulary and configure the domain-document rules.
This installation has not selected those project preferences or created tracker items.

List the installed skills with:

```sh
DO_NOT_TRACK=1 npx --yes skills@1.8.1 list --agent codex
```

Updates are deliberate: select a reviewed upstream revision, reinstall the chosen
Engineering and Productivity skills with the CLI, review the diff, and commit the
updated files and lock together. Keep upstream skill contents unchanged so their
lock hashes continue to verify; project architecture and explicit user instructions
retain precedence.
