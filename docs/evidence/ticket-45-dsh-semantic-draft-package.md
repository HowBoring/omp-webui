# Ticket 45 DSH semantic draft package

DSH's Conversation `./client` resolves to `lib/client.js`. That file is a CommonJS-format
factory for `window.__ModuleLoader__`. A static named import of `DraftTabOwner` failed in
fresh Node 24.22.1 and Bun 1.4.4 processes against a fresh build of the active three-patch
tree. Trying DSH's existing `dualClient` preset for the complete Conversation entry failed on
unresolved CSS modules, including `ConversationRoot.module.css` and `InputBar.module.css`.

The [packaging patch](../../compatibility/dsh/patches/semantic-draft-esm.patch) publishes the
existing draft decoder and eight identity constructors at
`@deepseek-ai/dsh-client-ui-conversation/client/semantic-draft`. The Node library preset bundles
the existing implementations and resolves the draft decoder's UI Primitives import to its
compiled quote formatter. Both builds use the same formatter source. The output name follows
DSH's `client.node.*` convention, which excludes it from browser chunk routing. Byte comparison
of the Conversation browser factory and source map before and after the patch passed.

| Input | Identity |
| --- | --- |
| Pinned DSH base commit | `38a6a5c965aa99ab525161efb7cc5cf1fe62fced` |
| Previous active tree after patches 1–3 | `1e1207058448079f0c7e45287c4fd39dca7d2de2` |
| Packaging patch SHA-256 | `52718beaff79d4892f2cf89768b9f7e8846b72d17e883007f9e308a8a70ff9d2` |
| Active tree after packaging patch | `d05468939bcb06446ace47045d138f716406c788` |
| Frozen `pnpm-lock.yaml` SHA-256 | `e32cb5d1bcf3c48c7570fc6b2014d3b2f0a65025031ee489b29173da8137cf6f` |
| Dormant tree after patches 1–9 | `1959e66066b7ddd6fc40c8f54c89afd48aa789d9` |
| Dormant tree with packaging patch | `71fac8a2c539f6022848da0697e1fab9090d035e` |

In separate Git indexes, applying the packaging patch before or after dormant patches 4–9
produced the same tree. Reversing the packaging patch recovered the original dormant 1–9 tree.
This replay covers source composition. Persistence review and a matched build of the dormant
cohort with the packaging patch remain pending. [Previous dormant preflight](ticket-45-dsh-build-preflight.md)

## Linux build and packed import

Node 24.22.1 and pnpm 11.28.5 installed the frozen workspace in an isolated, depth-one
Linux checkout. The five upstream typecheck gates passed on patches 1–3. The Host bundle
then completed, and after the packaging patch the full Client and Web bundles and both
aggregate checks passed. Both Host and final Client bundlers reported zero unresolved imports.
The workspace constraints passed and rejected a copy of the package manifest with the
new output removed from `files`. Client package checks passed for all 71 packages, and
the published Conversation package passed `publint`.

| Final build readback | Identity |
| --- | --- |
| Conversation browser `lib/client.js` SHA-256 | `64460ffc0bd6ac84307a9937acc294940e5a5bf0a36d424aba13025ea44d7197` |
| Conversation browser `lib/client.js.map` SHA-256 | `473099c9855b5fd94ac69f76b450e3d829cc56a12ed4671b0fb2f5661c8ba0eb` |
| Conversation `lib/client.node.semantic-draft.js` SHA-256 | `a8bf8fb61234486e2fb909ffcd95932611e05dce863bbbaac26cc5229724bcac` |
| Conversation package archive SHA-256 | `a7879b67f00f8ffefeb73cef8a3ad45178053e777b4d45ba2dd0fb4258342f66` |
| Scoped browser artifacts | 371 files, 160 under Web dist, 79,518,110 bytes |
| Scoped browser artifact SHA-256 | `57f8d6311d6d99c218e43d255e701bb32e0403930fc2ce6252e96327dbc03a26` |

Both HTML entry points resolved their local module references. The scoped digest follows the
upstream browser patterns and length-prefixed paths and bytes. The Node entry has its own
SHA-256 above. The complete-build reader rejected the absent
release record. This run used scoped build steps. Desktop, complete release validation,
and matched browser and Native Session acceptance remain pending.

The packed import probe ran in a directory containing only the unpacked Conversation package.
Node and Bun resolved the new public export to the published ESM file. All eight constructors
accepted a nonempty identity and rejected an empty one. The parser retained a quoted draft and
original reference and rejected an extra transient receipt field.

Use the [active manifest](../../compatibility/dsh/patches.json) to prepare an owned checkout.
From the DSH root with offline store and cache copies, run the upstream scoped build steps.

```bash
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1
export COREPACK_ENABLE_NETWORK=0 PNPM_CONFIG_OFFLINE=true
export DSH_CLIENT_COMMIT_HASH=38a6a5c DSH_CLIENT_GIT_DIRTY=true DSH_CLIENT_VERSION=0.2.2-rc.3
corepack pnpm install --offline --frozen-lockfile --ignore-scripts
node --import tsx/esm scripts/build.ts --scope typecheck --serial
corepack pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE host
corepack pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
corepack pnpm run build:web
node --import tsx/esm scripts/build.ts --scope check --serial
node --import tsx/esm scripts/check-workspace-constraints.ts
node --import tsx/esm scripts/verify-client-packages.ts
```

Run `corepack pnpm pack` in `packages/client/ui-conversation` and extract the archive under
`node_modules/@deepseek-ai/dsh-client-ui-conversation` in an empty scratch directory. With the
same cache flags, run a static named import of `DraftTabOwner` and `parseSemanticDraftRecord`
from the public `/client/semantic-draft` specifier in a fresh `.mjs` in that scratch directory
under both runtimes.
