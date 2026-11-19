# Isolated navigation fixture evidence

The isolated Host and page are acceptance carriers for #37, not product admission; private Session admission stays
blocked. The native worker is real. The Host adapters (authorization, joint idle, metadata repository, projection
rebuild) are fixture-owned, explicitly labeled in the operation report as `fixture-adapter`, and hold no tree,
messages or target snapshots.

- [browser.json](../../../docs/evidence/ticket-37-browser.json) is the actual matched Chromium → DSH typed
  Remote → Bun Host → public navigation Remote → real native worker report: explicit confirmation, committed
  operation, immediate kill, reopen, and a query that returns the same native commit.
- [ticket-37-tui.json](../../../docs/evidence/ticket-37-tui.json) is the real PTY report: the matched TUI renders
  only the recovered branch and exits cleanly; the installed baseline refuses the candidate data without rewriting
  it.
- [ticket-37-native-navigation.json](../../../docs/evidence/ticket-37-native-navigation.json) is the raw native RPC
  matrix (committed, crash, cancelled, unknown, write failure, invalid target).

See [the #37 evidence note](../../../docs/evidence/ticket-37-durable-navigation.md) for exact commands, seam labels
and remaining limits. `vendor/` bundles and the fixture profile are generated, not committed.
