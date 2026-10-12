# Curtis AI Porter — Agent Guide

Standalone converter (CLI + single-file web page + Obsidian plugin), TypeScript + esbuild. Sister project to the `curtis-ai-chat` Obsidian plugin.

## Build & verify

- `npm run build` — type-checks (`tsc -noEmit -skipLibCheck`) then bundles `dist/cli.mjs` + `dist/porter.html`. Run before declaring any task done.
- `npm test` — bundles tests then runs `node --test`. Zero failures before commit.
- `npx eslint --config eslint.review-check.config.mjs src/` — the Obsidian review bot's static checks (eslint-plugin-obsidianmd + unbound-method), run locally. Zero findings before a release.
- `npm start` — serve the web page at localhost:7777.

## Hard constraints

- **The contract is the spec.** `docs/curt-format.md` owns the `.curt` and Curtis-markdown formats; `src/core/` and the vendored oracles (`test/curtis-reference/`) are implementations measured against it. `src/core/` mirrors `curtis-ai-chat/src/import/` file-for-file (detect, chatgpt, claude, generic, curt — the .curt contract itself lives in `src/import/curt-format.ts` since plugin v2.0.1) plus `curtis-md.ts` (the vault transcript format, plugin-side in `src/chat/conversation-format.ts`); `test/curtis-contract.test.ts` catches drift. Format behavior changes never land unilaterally or as "improvements" — they are spec revisions, coordinated with a plugin release, re-vendoring the oracles and bumping the spec pin in the same change.
- **`.curt` ids follow the spec**: `conv_<ms>_<9 base36>` and `msg_<ms>_<6 base36>` (`src/core/ids.ts`). Foreign imports get fresh ids; `.curt`/Curtis-markdown round-trips must never reassign them.
- **`.curt` carries optional provenance**: porter-written files stamp `generator: curtis-ai-porter@<version>` (`src/version.ts`); readers ignore the field, and `verify` needs the same version to judge byte-canonicality.
- **Local-first is non-negotiable**: no network calls anywhere in the codebase. The web page runs from `file://` as a single file; the `serve` command exists only for a friendly URL.
- **Export is additive.** `src/core/export/` reads conversations and emits foreign formats; it never changes import or detection behavior. The ChatGPT-shape emitter must round-trip through the porter's own chatgpt parser — a test enforces it — so when they disagree, fix the emitter: the parser side mirrors the plugin.
- Release notes and copy: terse, no emoji.

## Layout

- `src/core/` — shared conversion library (Node + browser, no fs/DOM). Mirrors the plugin's `src/import/` module file-for-file (detect, chatgpt, claude, generic, curt — the .curt contract itself lives in `src/import/curt-format.ts` since plugin v2.0.1) plus `curtis-md.ts` (the vault transcript format from `src/chat/conversation-format.ts`); `grok.ts`, `gemini.ts`, `verify.ts` (round-trip checker behind the `verify` command) and `stats.ts` (history aggregation behind the `stats` command) are porter extensions with no plugin counterpart.
- `src/core/export/` — the export direction (`.curt`/markdown → continuation packs, ChatGPT-shape JSON, API JSONL). Additive only: never touches import/detection behavior.
- `src/plugin/` — the Obsidian plugin surface (`main`, `porter-view`, `settings`, `write`, `icons`). Standalone; works without Curtis AI Chat installed.
- `cli/index.ts` — CLI (`convert`, `export`, `verify`, `stats`, `serve`). Dist is `dist/cli.mjs`; never hand-edit. Lives outside `src/` deliberately: the Obsidian review's static scan flags Node builtins anywhere under `src/`, and the CLI is the one Node-only surface — `src/` stays browser-safe.
- `src/web/` — `index.html` + `app.ts`; esbuild inlines the app into `dist/porter.html`.
- `test/curtis-reference/` — VENDORED, verbatim snapshots of the plugin's `parseCurt` and `parseConversationMarkdown`, pinned to a plugin version (noted in each header). This is the standalone contract oracle: `npm test` never needs the plugin repo. When the plugin's parsers change, re-copy and bump the header.
- `test/contract-assertions.ts` — the shared contract suite. `curtis-contract.test.ts` runs it against the vendored snapshot; `curtis-contract-live.test.ts` runs it against the live plugin repo when checked out next door (esbuild only builds that entry when the sibling exists; `obsidian` aliases to `test/obsidian-stub.ts`).
- `docs/curt-format.md` — the normative format spec (`.curt` envelope + Curtis markdown), pinned to a plugin release. The contract is defined there; `src/core/` and the vendored oracles are measured against it. Update the spec, the oracles, and the core together when the plugin releases parser changes.
