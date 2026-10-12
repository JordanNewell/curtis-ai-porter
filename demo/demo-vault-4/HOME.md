# demo-vault-4 — carol (audit)

The audit vault for the Curtis AI stack. Two plugins installed and enabled:

- **Obsidian Messenger** — this vault is `carol` on the bus (3s polling, debug notices)
- **Curtis AI Audit** — ledger + OM-1 inbox ingest (3s polling, debug notices)

## Try it (5 minutes)

1. **Open the ledger**: `Ctrl/Cmd+P` → **Curtis AI Audit: Open today's ledger**.
   The `Audit/ledger/` folder appears with today's (empty) shard.
2. **File a receipt from the bus**: `Ctrl/Cmd+P` → **Obsidian Messenger: Send message**
   - to: `audit`
   - body:
     ```json
     {"action":"inference","model":"gpt-4o","provider":"openai","status":"ok","durationMs":1234,"tokens":{"input":812,"output":341},"summary":"Demo receipt from carol's keyboard"}
     ```
3. Wait ~3s (or run **Curtis AI Audit: Check audit inbox now**). A debug notice
   fires and the receipt lands in today's shard — envelope is the canonical-JSON
   receipt, body is the rendered summary.
4. **Verify**: **Curtis AI Audit: Verify ledger** → "OK: 1 receipt(s), no issues".
5. **Digest**: **Curtis AI Audit: Write digest** → `Audit/digest.md` opens with
   the counts, statuses, and token totals.

## File a receipt from outside Obsidian (PowerShell)

```powershell
$body = '{"action":"inference","model":"gemini-2.5-pro","status":"ok","summary":"Nightly run"}'
$id = "msg_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString("x") + (Get-Random -Maximum 9999)
$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$inbox = "E:\dev\projects\curtis-ai-porter\demo\demo-vault-4\Messenger\audit\inbox.md"
Add-Content -Path $inbox -Value "<!-- messenger: {`"id`":`"$id`",`"from`":`"nightly-agent`",`"to`":`"audit`",`"ts`":`"$ts`",`"replyTo`":null} -->`n$body`n<!-- /messenger -->`n"
```

Run it, wait 3s — the receipt arrives with `agent: nightly-agent` (the bus
sender), in its own sequence series. No plugin API, no network: anything that
can append to a file can file receipts.

## The honest tamper demo

Open today's ledger, delete one block (any editor), save, then run
**Curtis AI Audit: Verify ledger**. The missing sequence number is reported
as a gap — deletions leave holes. That is the entire tamper-evidence story:
it catches the casual and accidental cases; it does not defeat a determined
editor, and SPEC.md says so.

## What to look at

- `Audit/ledger/YYYY-MM-DD.md` — append-only receipts, one shard per day
- `Audit/digest.md` — rolling summary (counts, statuses, tokens, errors)
- `Messenger/registry.md` — who's on the bus (curtis-ai-audit registers here)
- `Messenger/audit/inbox.md` — the OM-1 inbox senders append to
- Full contract: `SPEC.md` in the curtis-ai-audit repo
