# Contributing

Issues and PRs welcome. This is a standalone converter (CLI + single-file web page + Obsidian plugin) sharing one core library; keep that shape in mind when proposing changes.

## Setup

```
npm install
```

## Build & verify

- `npm run build` — type-checks (`tsc -noEmit -skipLibCheck`) then bundles `dist/cli.mjs`, `dist/porter.html`, and the plugin `main.js`. Run before declaring any task done.
- `npm test` — bundles tests then runs `node --test`. Zero failures before commit.
- `npm start` — serves the web page at localhost:7777.

## Ground rules

- **The contract is the spec.** `docs/curt-format.md` owns the `.curt` and Curtis-markdown formats. `src/core/` and the vendored oracles in `test/curtis-reference/` are implementations measured against it; `test/curtis-contract.test.ts` catches drift. Format changes are spec revisions — update the spec, the oracles, and the core in the same change.
- **`.curt` ids are permanent.** Foreign imports get fresh ids; round-trips never reassign them.
- **Local-first, non-negotiable.** No network calls anywhere in the codebase.
- **Export is additive.** `src/core/export/` never changes import or detection behavior. When the ChatGPT-shape emitter and the parser disagree, fix the emitter.
- Release copy is terse, no emoji.

## Releases

Bump the version in `manifest.json` + `package.json`, add the entry to `versions.json`, then push a tag named for the bare version (`0.Y.Z`). CI builds from the tag, runs the tests, signs build-provenance attestations, and publishes the release. One tag per version — duplicate `v`-prefixed and bare tags for the same version confuse tooling that matches tags to manifest versions.
