# Curtis AI Porter — demo vault

Two plugins are installed here:

- **Curtis AI Chat** (amber icon) — the chat itself
- **Curtis AI Porter** (green icon in the left ribbon) — the standalone porter: drop exports in, get vault files out

This vault exists to show chat porting end to end. Open the Curtis ribbon → chat **history** — three conversations came from a ChatGPT export zip, converted to these markdown files by Curtis AI Porter:

- `AI/Conversations/2024-12-29 Kyoto in November …md`
- `AI/Conversations/2024-12-30 Sourdough emergency …md`
- `AI/Conversations/2024-12-31 Kubernetes blue-green rollout …md`

They're ordinary vault notes — search them, edit them, click one in Curtis history and keep chatting with whatever provider you have active.

## Try the import landing page

Click **`Rust or Go for a side project.curt`** in the file explorer (vault root). That's a transcript that was *copy-pasted* out of DeepSeek — Curtis AI Porter turned it into a portable `.curt` file. Double-click it for Curtis's one-click import.

## Things to try

1. **The Porter itself** — click the **green Curtis AI Porter icon in the left ribbon**. Drag `claude-export.json` and `curtis-chats-demo.zip` (from the porter repo's `demo/fixtures/`) straight onto its drop zone, then **Write to vault** — Curtis's history picks them up instantly, same folder, same format.
2. **Paste porting** — in the Porter view, paste any transcript (You:/AI: labels) and convert it. That's how this vault's `Rust or Go for a side project.curt` was born — from a DeepSeek copy-paste.
3. **Import landing page** — double-click `Rust or Go for a side project.curt` in the file explorer for Curtis's one-click import page.
4. **Right-click porting** — right-click any `.zip` / `.json` / `.md` in the explorer → "Port into vault (Curtis AI Porter)".
5. **Bulk export** — command palette → "Export ported chats as .curt (zip)" (Porter) or "Export all chats as .curt (zip)" (Curtis). The zip you get is itself importable anywhere.
6. **Settings → Curtis AI Porter** — output folder (default `AI/Conversations`, which is exactly where Curtis looks) and whether to keep `.curt` copies.
