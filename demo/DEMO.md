# Demo — the porter in action

Everything here is local: fixtures are synthetic exports, the vault is throwaway, nothing touches your real vault.

## One-time setup

```
npm install
npm run build                  # porter: dist/cli.mjs + dist/porter.html
```

The vault also wants the Curtis plugin build. Check out the Curtis plugin repo
as a sibling of this repo and build it there (`npm run build` — produces
`main.js`); `demo/sync-vault.mjs` finds it under either name (`../curtis-ai-chat`
or `../curtis`), or point it at the checkout with `CURTIS_PLUGIN_REPO`. Then,
back in this repo:

```
node demo/make-fixtures.mjs    # synthetic ChatGPT/Claude/DeepSeek/bulk exports
node demo/sync-vault.mjs       # installs the plugin build into demo/demo-vault-2
```

## What's already done in the vault

`demo/demo-vault-2/` ships seeded (see `HOME.md` inside the vault):

- A ChatGPT export zip was converted by the CLI into three chats in `AI/Conversations/`:
  `node dist/cli.mjs convert demo/fixtures/chatgpt-export.zip --format md --out demo/demo-vault-2/AI/Conversations`
- A DeepSeek copy-paste became a `.curt` file at the vault root:
  `node dist/cli.mjs convert demo/fixtures/deepseek-paste.md --format curt --out demo/demo-vault-2`

## See it live

1. **Obsidian** — open `demo/demo-vault-2` as a vault (Obsidian will ask to trust/enable community plugins — accept). Open the Curtis ribbon → history shows the three seeded chats; click `Rust or Go for a side project.curt` for the import landing page.
2. **Web UI** — open `dist/porter.html` in a browser (double-click it; no server needed) or `npm start` → http://localhost:7777. Drag `demo/fixtures/claude-export.json` and `demo/fixtures/curtis-chats-demo.zip` in, tick conversations, download `.curt` / vault markdown.
3. **CLI** — any fixture:
   ```
   node dist/cli.mjs convert demo/fixtures/claude-export.json --out /tmp/porter-demo
   ```

## Re-seed from scratch

Delete `demo/demo-vault-2`, then `node demo/sync-vault.mjs` and the two `convert` commands above.
