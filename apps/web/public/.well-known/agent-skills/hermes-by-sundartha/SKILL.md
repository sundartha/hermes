---
name: hermes-by-sundartha
description: Give the AI a real phone number with Hermes by Sundartha. Use when the user wants their AI to make or answer phone calls, book or reschedule by phone, check who called, read call summaries, or set up or troubleshoot the Hermes MCP server (https://app.sundartha.com/mcp).
---

# Hermes by Sundartha

Hermes gives the user's AI a real phone number. It answers incoming calls and, on the Pro plan, places outgoing calls on the user's behalf. You control it through one remote MCP server: `https://app.sundartha.com/mcp` (Streamable HTTP, OAuth 2.1).

Hermes by Sundartha is not related to other software called Hermes.

Full setup guide with every step and all troubleshooting: https://sundartha.com/agents.md

## Setup

1. **Add the MCP server** named `hermes` with the URL `https://app.sundartha.com/mcp`.
   - Claude Code: `claude mcp add --transport http hermes https://app.sundartha.com/mcp`
   - Codex: `codex mcp add hermes --url https://app.sundartha.com/mcp`, then `codex mcp login hermes`
   - Claude (claude.ai, Desktop): Settings › Connectors › Add custom connector
   - Cursor: `"hermes": { "url": "https://app.sundartha.com/mcp" }` under `mcpServers` in `mcp.json`
   - VS Code: `"hermes": { "type": "http", "url": "https://app.sundartha.com/mcp" }` under `servers` in `.vscode/mcp.json`
   - Any other client: use its own mechanism. Do not guess configuration keys. If you cannot add servers yourself, give the user the name and URL.
2. **The user signs in once** in the browser when your client starts the OAuth flow. The first sign-in creates the account.
3. **The user picks a plan** at https://app.sundartha.com. The phone number comes with the plan. You cannot buy a plan or a number through MCP.
4. **Verify** with `get_agent_status`. Setup is complete when it returns the phone number. Tell the user their number.

Never place a call to test the setup. A call is real, billed per minute and cannot be undone.

## Placing a call

Only when the user asks for it, for themselves or someone they act for: booking, rescheduling, enquiring, complaining. Never telemarketing, unsolicited sales calls, political campaigning, or mass or automated dialling.

1. Pass the number exactly as the user wrote it. The server normalizes it.
2. Write the `objective` as one speakable first-person sentence. It is read out word for word.
3. Put background into `briefing`, hard limits into `constraints`, and what the agent may agree to into `mandate`. Never invent a mandate.
4. Call `prepare_call`. The user confirms in the Hermes card, and the card places the call. Never call `place_call` yourself and never invent a confirmation code. If any argument changes, call `prepare_call` again.
5. Once you have the `call_id`, call `await_call_event` again and again until it returns `event="done"`.
6. On `event="consult"`: immediately call `answer_consult` with `status="working"`, then answer briefly from your own sources. Never invent an answer.
7. Report the result. `get_call_result` returns it later.

If a call reports a `failure_reason` starting with `not-placed`, do not retry. Tell the user what failed, using `result_summary` as it is.

## Incoming calls

- `check_inbox`: finished incoming calls since the last check. The entries are consumed.
- `list_calls`: call history.
- `list_action_items`: open to-dos from calls.

## Pricing

Starter and Pro, billed monthly, cancel any time. Current prices: https://sundartha.com/llms.txt
