# Issue tracker: GitHub

Issues and specs live in https://github.com/HowBoring/omp-webui/issues.
Prefer connected GitHub tools; use gh CLI when needed.

Read issue bodies, comments and labels before acting. Publishing a spec or
ticket means creating a GitHub issue. For multiline CLI bodies, use --body-file.

PRs as a request surface: no.

## Wayfinding operations

- Map: one issue labelled wayfinder:map.
- Tickets: child issues, labelled wayfinder:research, wayfinder:prototype,
  wayfinder:grilling or wayfinder:task.
- Parenting: use native GitHub sub-issues. If unavailable, use a task list
  on the map and a "Part of" link in each child.
- Blocking: use native issue dependencies. If unavailable, record
  "Blocked by" links in each ticket.
- Frontier: open, unassigned children whose blockers are all closed.
- Claim: assign the ticket to the driving developer before starting work.
- Resolve: post the resolution, close the ticket, and append a named link
  with a one-line gist to the map's Decisions so far.
- Refer to maps and tickets by linked title, not bare issue numbers.
