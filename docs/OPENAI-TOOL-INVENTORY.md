# Hermes MCP tool inventory (for the OpenAI reviewer)

> **Purpose.** H7 (Kickoff I / I-4 / DP-5) and H8 (N-5) of the OpenAI-P10a hygiene phase. The
> set of tools Hermes registers varies by tenant/transport (9, 10, 11 or 12 tools) - a reviewer
> who sees one set must not assume every user sees the same one. This document records that
> variance, with the exact name set per configuration and, per tool, one sentence of reasoning
> behind each annotation. The counts and the wire values were **measured against the real
> `tools/list` output** (test/openai-p10a-tool-inventar.test.js, K1-K6 below), not read off the
> source and transcribed. This document does not change any behaviour (P10a hard limit: no
> executable line in `src/`).
>
> Format note: each table also carries a fenced machine-readable block. The test that pins this
> document parses those blocks; the prose tables above them are for human readers only and are
> not themselves parsed.

## Table A - all 12 tools, in registration order

Registration order and grouping condition: `src/mcp-tools.js:914-1494` (`uiTool(...)` calls
inside `registerTools()`). Condition column: "always" (registered unconditionally), "consult"
(`if (consultAllowed)`, `src/mcp-tools.js:1111`) or "calendar" (`if (allowCalendar)`,
`src/mcp-tools.js:1449`). `consultAllowed` for a request is `consultAllowedFor(profile)` =
`config.tenancy.consultEnabled === true && config.tenancy.assistantContextEnabled === true &&
profile?.allowConsult === true` (`src/consult/gate.js:19-25`, unchanged by this phase).

| name | title | condition | readOnlyHint | destructiveHint | openWorldHint | idempotentHint |
|---|---|---|---|---|---|---|
| place_call | Place a phone call | always | false | true | true | false |
| await_call_event | Wait for call update | consult | false | false | false | true |
| answer_consult | Answer call question | consult | false | true | true | false |
| get_call_status | Get call status | always | true | false | false | - |
| get_transcript | Get call transcript | always | true | false | false | - |
| cancel_call | Cancel a call | always | false | true | true | true |
| get_my_number | Agent phone number | always | true | false | false | - |
| list_calls | List calls | always | true | false | false | - |
| check_inbox | Check inbox | always | false | false | false | false |
| list_action_items | List action items | always | true | false | false | - |
| get_calendar | Get calendar | calendar | true | false | false | - |
| get_agent_status | Get agent status | always | true | false | false | - |

Values match `TOOL_ANNOTATIONS` (`src/mcp-tools.js:637-711`), which is the single source
registerTool draws from (`src/mcp-tools.js:904-905`).

Machine-readable block (`name|condition|readOnlyHint|destructiveHint|openWorldHint|idempotentHint`,
`-` = hint not set):

```text
TABLE-A-BEGIN
place_call|always|false|true|true|false
await_call_event|consult|false|false|false|true
answer_consult|consult|false|true|true|false
get_call_status|always|true|false|false|-
get_transcript|always|true|false|false|-
cancel_call|always|false|true|true|true
get_my_number|always|true|false|false|-
list_calls|always|true|false|false|-
check_inbox|always|false|false|false|false
list_action_items|always|true|false|false|-
get_calendar|calendar|true|false|false|-
get_agent_status|always|true|false|false|-
TABLE-A-END
```

### Annotation reasoning (H8, N-5: one sentence of reasoning per annotation)

`readOnlyHint`/`destructiveHint`/`openWorldHint` are OpenAI-required on every tool (`X-1`/`N-1`);
Hermes sets all three on all 12 tools even where the MCP spec would allow omitting two of them,
because the OpenAI wording wins on conflict (`src/mcp-tools.js:610-616`). `idempotentHint` stays
optional and is set only where it says something (`src/mcp-tools.js:617-619`).

- **place_call** (`src/mcp-tools.js:1075`): not read-only and not idempotent - it dials a real
  outbound call, and a later call to a number that is no longer mid-call dials again
  (deduplication only covers the duration of the running call, disclosed in the tool
  description per N-11). `openWorldHint: true` and `destructiveHint: true` because it acts on
  the real phone line/carrier (`src/mcp-tools.js:614-618`, `:622-625`).
- **await_call_event** (`src/mcp-tools.js:1130`): not read-only, because each poll also writes
  to the call record (marks a pending question delivered, notes the poll -
  `noteConsultPoll`/`markConsultAskDelivered`, `src/store/state-ops.js`, called from
  `src/routes/api-calls.js`). `idempotentHint: true` because repeated identical polls before the
  next event settle to the same observable state. `openWorldHint: false` - it only reads/writes
  the tenant-local store (`src/mcp-tools.js:614-616`), even though it reports on an outside call.
- **answer_consult** (`src/mcp-tools.js:1185`): `destructiveHint: true` because the submitted
  text is spoken on the live call (`src/routes/api-calls.js:690`) and therefore not retractable
  (`src/mcp-tools.js:619-621`, literally "even ... through indirect side effects", N-3).
  `openWorldHint: true` for the same reason as place_call - it acts on the live line.
  `idempotentHint: false` because a second call with the same arguments is spoken again -
  answering the same question twice is a second, distinct spoken side effect, not a no-op.
- **get_call_status** (`src/mcp-tools.js:1222`): pure read of the tenant-local store
  (`GET /api/calls/:id`, `src/routes/api-read.js:98`) - `readOnlyHint: true`,
  `openWorldHint: false`.
- **get_transcript** (`src/mcp-tools.js:1281`): same reasoning as get_call_status - reads the
  stored transcript, no outside access.
- **cancel_call** (`src/mcp-tools.js:1328`): `destructiveHint: true` and not read-only - it ends
  a real, running call. `idempotentHint: true` - cancelling an already-finished call is a no-op,
  not an error. `openWorldHint: true` - it acts on the carrier/line.
- **get_my_number** (`src/mcp-tools.js:1345`): pure read of the tenant's own number record - no
  outside access.
- **list_calls** (`src/mcp-tools.js:1374`): pure read of the tenant-local call list.
- **check_inbox** (`src/mcp-tools.js:1403`): not read-only - `POST /api/inbox/poll` writes the
  read/seen status of inbox entries as a side effect of listing them. Not destructive (nothing
  irreversible happens) and not open-world (tenant-local store only). `idempotentHint: false`
  because a second call can mark additional entries seen that a first call did not (new entries
  may have arrived between calls) - the observable state is not guaranteed to settle.
- **list_action_items** (`src/mcp-tools.js:1428`): pure read of the tenant-local action-item
  list.
- **get_calendar** (`src/mcp-tools.js:1460`): pure read of the tenant-local calendar view - no
  outside access, even though the underlying data originates from a call.
- **get_agent_status** (`src/mcp-tools.js:1500`): pure read of tenant-local agent/usage state.

## Table B - tool count and exact name set per configuration

The **numbers are measured on the real wire** (HTTP `/mcp` and the stdio child process
`src/mcp-server.js`), not derived from Table A by hand - see
`test/openai-p10a-tool-inventar.test.js`.

| K | transport | identity/profile | switches | count |
|---|---|---|---|---|
| K1 | HTTP | Bootstrap owner (`OWNER_PROFILE`, `src/store/defaults.js:1056-1065`) | Consult + AssistantContext on | 12 |
| K2 | HTTP | Bootstrap owner | BASE_ENV default (Consult off) | 10 |
| K3 | HTTP (OAuth) | Tenant without a stored profile (`DEFAULT_PROFILE`, `src/store/defaults.js:1069-1078`) | Consult on | 9 |
| K4 | HTTP (OAuth) | Tenant with `planProfileFor("starter")` (`src/plans.js:107-111`, `:154`) | Consult on | 11 |
| K5 | HTTP (OAuth) | Tenant with the same plan profile | Consult off | 9 |
| K6 | stdio (`src/mcp-server.js`) | no tenant (defaults `allowCalendar=true`, `consultAllowed=false`, `src/mcp-tools.js:802-810`) | irrelevant (stdio never registers the consult tools) | 10 |

K3's and K5's counts coincide (9), but for different reasons: K3 has no stored profile at all
(fails closed to `DEFAULT_PROFILE`), K5 has the paid-plan profile but the platform-wide consult
switch is off. Their name sets are identical (neither carries `get_calendar` nor the two consult
tools). K2's and K6's counts also coincide (10) for a similar reason: the owner profile and the
stdio defaults both carry `allowCalendar: true` with consult unavailable, so both carry
`get_calendar` but neither carries the two consult tools.

Machine-readable block (`K|transport|count|comma-separated tool names in Table A order`):

```text
TABLE-B-BEGIN
K1|http|12|place_call,await_call_event,answer_consult,get_call_status,get_transcript,cancel_call,get_my_number,list_calls,check_inbox,list_action_items,get_calendar,get_agent_status
K2|http|10|place_call,get_call_status,get_transcript,cancel_call,get_my_number,list_calls,check_inbox,list_action_items,get_calendar,get_agent_status
K3|http-oauth|9|place_call,get_call_status,get_transcript,cancel_call,get_my_number,list_calls,check_inbox,list_action_items,get_agent_status
K4|http-oauth|11|place_call,await_call_event,answer_consult,get_call_status,get_transcript,cancel_call,get_my_number,list_calls,check_inbox,list_action_items,get_agent_status
K5|http-oauth|9|place_call,get_call_status,get_transcript,cancel_call,get_my_number,list_calls,check_inbox,list_action_items,get_agent_status
K6|stdio|10|place_call,get_call_status,get_transcript,cancel_call,get_my_number,list_calls,check_inbox,list_action_items,get_calendar,get_agent_status
TABLE-B-END
```

## What the reviewer will see

The set of tools a reviewer or user sees depends on which account and transport they connect
with - it is not a fixed catalog:

- The full set of 12 tools is reached **only** by the bootstrap owner account
  (`OWNER_PROFILE`) with both `CONSULT_ENABLED` and `ASSISTANT_CONTEXT_ENABLED` on (K1).
- A paying tenant on any catalog plan (`starter` or `business`, `src/plans.js:146-148`) reaches
  **at most 11** - `get_calendar` is deliberately off for every paid plan
  (`PAID_PLAN_PROFILE.allowCalendar: false`, `src/plans.js:107-111`; see the plan-profile
  comment there for why).
- A tenant with no stored profile at all reaches 9, same as a paid tenant with the consult
  channel switched off.
- The stdio entry point (Claude Desktop, or any local MCP client that launches
  `src/mcp-server.js`) never registers the two consult tools - it has no context channel to a
  human on the other end of that pipe - but does carry `get_calendar` by default.

The **live values of the platform switches** (`CONSULT_ENABLED`, `ASSISTANT_CONTEXT_ENABLED`)
are Render-dashboard-maintained and are **not** recorded in this document - `render.yaml` is not
authoritative for them (see the P4 test comment fixed under H4 of this phase). This document
makes no "production runs with X" claim.

## Why the variance is not resolved in code

The variance is deliberate product behaviour, not a defect: a tool a caller has no permission
for is not registered at all, rather than registered and then answered with an error. Making
every account see all 12 tools and rejecting the unauthorized ones at call time would violate
N-13 and would also mean a client's `tools/list` no longer reflects what it can actually do.
Source: `src/consult/gate.js:19-25` (the same gate function decides both whether the consult
tools are registered here and whether the consult channel is offered on a live call).

The transport does not add a second axis here: the mcp-native adapter and the ChatGPT adapter
(both reached over HTTP) share the exact same tool registration - `enableWidgetUi` only changes
per-tool `_meta`, never which tools exist (`src/mcp-tools.js:863-870`).
