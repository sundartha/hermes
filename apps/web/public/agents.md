# Hermes by Sundartha — setup guide for AI agents

> This page is written for AI agents. If a user sent you here ("Set up Hermes by Sundartha for me"), follow the steps below in order. Hermes gives your user's AI a real phone number: it answers incoming calls and, on the Pro plan, places outgoing calls on the user's behalf. You control it through one remote MCP server.

## At a glance

| | |
|---|---|
| MCP server URL | `https://app.sundartha.com/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth 2.1, discovered automatically (the server answers `401` with `WWW-Authenticate` → `https://app.sundartha.com/.well-known/oauth-protected-resource`) |
| Account | Created automatically on the user's first sign-in |
| Phone number | Comes with a paid plan that the user chooses |
| Needs the human | Signing in once in the browser, choosing a plan |

## Requirements

- An MCP client that can add a **remote MCP server over Streamable HTTP with OAuth** (for example Claude, Claude Code, ChatGPT, Codex or any other MCP client).
- A human with a browser. Signing in and choosing a plan can only be done by the user — you cannot finish these two steps alone.

## Step 1 — Add the MCP server

**Claude Code (terminal):**

```bash
claude mcp add --transport http hermes https://app.sundartha.com/mcp
```

**Claude (claude.ai / Claude Desktop):** Settings › Connectors › Add custom connector → Name `Hermes`, Server URL `https://app.sundartha.com/mcp` → Connect.

**Codex:**

```bash
codex mcp add hermes --url https://app.sundartha.com/mcp
codex mcp login hermes
```

**Cursor:** add this under `mcpServers` in `mcp.json`, or give the user the one-click link `cursor://anysphere.cursor-deeplink/mcp/install?name=hermes&config=eyJ1cmwiOiJodHRwczovL2FwcC5zdW5kYXJ0aGEuY29tL21jcCJ9`:

```json
"hermes": { "url": "https://app.sundartha.com/mcp" }
```

**VS Code:** add this under `servers` in `.vscode/mcp.json`, or give the user the one-click link `vscode:mcp/install?%7B%22name%22%3A%22hermes%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapp.sundartha.com%2Fmcp%22%7D`:

```json
"hermes": { "type": "http", "url": "https://app.sundartha.com/mcp" }
```

**Agent Skill (optional):** `npx skills add https://sundartha.com` installs the skill `hermes-by-sundartha` with these rules for agents such as Claude Code, Codex, Cursor and OpenClaw.

**Any other MCP client:** add a remote MCP server named `hermes` with the URL `https://app.sundartha.com/mcp` and the Streamable HTTP transport, using your client's own mechanism. Do not guess configuration keys. If you cannot add servers yourself, give the user the name and URL and ask them to add it.

## Step 2 — Sign in (the user does this)

On the first connection the server responds `401` and your client starts the OAuth flow.

1. Show the authorization link to the user and ask them to open it and sign in.
2. There is no separate registration: the first sign-in creates the Hermes account.
3. Wait until the user confirms, then reconnect or reload the tools.

## Step 3 — Get a phone number (the user does this)

A phone number is part of a paid plan. After signing in, the user picks a plan in the dashboard at `https://app.sundartha.com` and pays through Stripe.

- **Starter** — Hermes answers incoming calls and summarizes them.
- **Pro** — additionally places outgoing calls for the user (`place_call`).
- Plans are monthly and can be cancelled at any time. Prices: `https://sundartha.com`.

You cannot buy a plan or a number through MCP. This is intentional.

## Step 4 — Verify the setup

1. Call `get_agent_status` (or `get_agent_number`).
2. Setup is complete when it returns the phone number together with the plan and permissions.
3. Tell the user their Hermes number.

**Do not place a call to test the setup.** A placed call is a real phone call that is billed per minute and cannot be undone. Only prepare a call when the user clearly asks for one.

## Tools

Rely on your own `tools/list` — some tools only appear when the account or plan supports them.

| Tool | What it does |
|---|---|
| `get_agent_status` | Status of the phone agent: phone number, owner, number of calls, share of the monthly minutes used, permissions. |
| `get_agent_number` | The agent's phone number. |
| `prepare_call` | Prepares a call for the user's confirmation. No cost, no call, nothing irreversible. |
| `place_call` | Places the call. The Hermes card uses it after the user confirms — you never call it yourself. |
| `await_call_event` | Waits briefly (up to ~20 s) for the next event of a running call: a question from the phone agent, the final result, or nothing. |
| `answer_consult` | Answers a question the phone agent asks you during a running call. |
| `get_call_status` | Live state of a call (dialing, in_progress, completed, failed, cancelled), duration, last transcript lines. |
| `get_call_result` | After the call: the result summary, whether the objective was achieved, commitments, open points and the next step (never the raw transcript). |
| `cancel_call` | Cancels the call record and stops billing. Whether the line itself drops is not guaranteed on every call path — the response says so. |
| `check_inbox` | Incoming calls that finished since the last check: who called, what they wanted, what was promised, what to do now. **Consuming** — returned entries will not appear again. |
| `list_calls` | Recent calls (incoming and outgoing) with status and summary. Use this to re-read history. |
| `list_action_items` | Open action items from all calls. |

## Placing a call

Only when the user asks for it — for themselves or someone they act for, such as booking, rescheduling, enquiring or complaining. Never for telemarketing, unsolicited advertising or sales calls, political campaigning, or mass or automated dialling.

1. **Number (`to`)** — pass the number **exactly as the user wrote it**. Do not reformat it into E.164; the server normalizes it. A national number with a leading 0 is resolved through the user's home country. For a foreign number, ask the user for the international format (`+XX…`) instead of guessing.
2. **Objective (`objective`)** — one speakable first-person sentence. It is read out word for word to the person who answers. Good: "I would like to book a men's haircut for Max on Saturday morning." Bad: "Book appointment". If the topic itself is unknown, ask the user first.
3. **Context** — put background into `briefing` (summarized, never secrets or payment data), hard limits into `constraints`, and what the agent may agree to without asking into `mandate`. Without a `mandate` the agent commits to nothing and only takes messages. Never invent a mandate.
4. **Prepare the call** with `prepare_call` and what you have. An open detail costs nothing; a guessed one cannot be taken back.
5. **The user confirms.** Your client shows a Hermes card where the user reviews and confirms the call. The card places it and reports the `call_id` back in the chat. Never call `place_call` yourself and never ask for or invent a confirmation code. If your client cannot show the Hermes card, no call can be placed from there — tell the user honestly. If any argument changes, call `prepare_call` again and let the user confirm again.
6. **Stay in the loop:** once you have the `call_id`, call `await_call_event` with it again and again until it returns `event="done"`.
7. **When `event="consult"` arrives:** immediately call `answer_consult` once with `status="working"` and no answers — if that acknowledgement does not arrive within seconds, the phone agent moves on without you. Then answer briefly and factually from your own sources (calendar, mail, files, this chat). Ask the user only if they are present right now. Never invent an answer; if you don't know, say so through `answer_consult` so the agent can tell the other party that the user will get back to them.
8. **Result:** the `done` event carries the summary and whether the objective was achieved. Report it to the user. `get_call_result` returns the same result later.

If a call reports a `failure_reason` starting with `not-placed`, the call could not be placed because of a problem on Hermes' side. **Do not retry.** Tell the user what failed, using `result_summary` as it is.

Destinations that are not allowed (permission profile, allowlist, denylist, country, limits) are refused by the server with a clear message. Do not try to work around it.

## Incoming calls

Hermes answers incoming calls on its own.

- `check_inbox` — what's new since the last check. Use it once per check; the entries are then marked as seen.
- `list_calls` — to browse or re-read call history.
- `list_action_items` — open to-dos that came out of calls.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `401` / `invalid_token` | Sign-in missing or expired. Run the OAuth flow again (Step 2). |
| No phone number in `get_agent_status` | No active plan yet. The user chooses one in the dashboard (Step 3). |
| Call refused | Destination blocked by the safety gates, or the plan does not include outgoing calls. Tell the user; do not retry with variations. |
| No Hermes card appears | Your client cannot show the confirmation card, so no call can be placed from it. Tell the user; do not ask for a code. |
| Tools missing after sign-in | Reconnect or reload the MCP server in your client. |

## Links

- Website: https://sundartha.com (as Markdown: https://sundartha.com/index.md)
- Overview for AI agents: https://sundartha.com/llms.txt
- Dashboard: https://app.sundartha.com
- Contact: kontakt@sundartha.com

Hermes by Sundartha is not related to other software called Hermes.
