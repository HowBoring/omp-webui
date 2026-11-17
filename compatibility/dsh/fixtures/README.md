# Parsed Tool argument fixtures

These fixtures exercise the existing public Conversation module and GenericToolCard with
controlled, already admitted display events. They do not establish Native ownership.
No Native, Host, serializer, browser, provider or tool runtime is loaded.

`guard.ts` reuses the existing preference no-I/O guard and rejects Native/FFI/binary module
loads. `tsconfig.json` selects one existing React installation for static rendering;
it does not change the DSH build. `contract.fixture.ts` checks the actual authored public
types with both valid callers and required compile failures.

For the transitive no-emit source comparison, set `DSH_BASE_SOURCE` to the exact read-only
DSH source containing patches1–5 and run `typecheck-source.mjs` with the affected module
paths. `TOOL46_BASELINE=1` reads that source unchanged; omitting it overlays owned changed
source at the same source locations. It preserves the upstream strict flags and performs
no emit or generation. Known baseline errors remain failures and must be reported.
The `.mjs` file reads source through TypeScript; it does not import/execute those modules.

The public assembler and snapshot-builder source exports are mapped to their exact
source files for the no-emit source check. They are real modules, without test replacements.
The React fixture is explicitly partial output evidence, with no actual-page inspection.

See [the compatibility README](../README.md) for commands and required release gates.
