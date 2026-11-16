# Retained Linux interaction evidence

These summaries cover the same native source/schema and built S0 Host/DSH client.
`tuple.json` binds ordered patch bytes, source/schema, Bun executable, Host bundle,
DSH source/lock/client assets and fixture/guard source. Each browser summary keeps
hashes of the ignored raw Playwright trace, screenshot, full summary and Host log.

- `linux-browser.json`: actual Chromium, default 30-minute target, 10 cases.
- `configured-browser.json`: actual Chromium, 4-second Host target, 11 cases,
  including expiry while all viewers are disconnected.
- `native-trace.json`: actual guarded native suite under strace, separate from
  browser loopback traffic; blocked metadata attempts and INET dispatch differ.

Regenerate using `scripts/trace-interactions.py`, both browser commands in
`compatibility/INTERACTIONS.md`, then `python3 scripts/retain-interactions-evidence.py`.
No raw user data or credentials are present: every profile/Session is synthetic.
Product admission and Windows acceptance are outside this evidence.

The current browser summaries were rerun after the independent review fixes and
shared carrier/build extraction. `tuple.json.nativeTraceReused` explicitly records
that the unchanged native-only syscall trace was retained; its OMP identity and
native guard/fixture hashes are verified before reuse. `review-fix/` retains both
red regressions and exact new validation outcomes, including setup failures.

`control-fix/` records the later cancellation-waiter correction, including its
actual HTTP/Remote held-native-ack red and green results. It supersedes the older
review's implication that sharing one native promise bounded external callers.
Current browser summaries and tuple describe this corrected Host; native source,
schema and guard/fixture trace identities remain unchanged.
