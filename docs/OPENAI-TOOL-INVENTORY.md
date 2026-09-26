# Hermes MCP tool inventory (for the OpenAI reviewer)

> **Purpose.** The set of tools Hermes registers varies by transport and consult capability (10
> or 12 tools). A reviewer who sees one set must not assume every user sees the same one. This
> document records that variance - the exact name set per configuration - and, per tool, the
> reasoning behind each of the three required annotations (`readOnlyHint`, `destructiveHint`,
> `openWorldHint`) and the optional `idempotentHint`.
>
> Counts, names, titles and annotation values were **measured against the real `tools/list`
> output** over HTTP and over stdio, not read off the source. Repository evidence: the test
> `test/openai-p10a-tool-inventar.test.js` parses both the prose tables and the
> machine-readable blocks in this document and compares them with the wire in every
> configuration listed in Table B; a mismatch fails the test. This document changes no
> behaviour.
>
> The reasoning below describes what each tool does, and it says the same thing as the tool's
> own `description` in `tools/list`. File:line references point into this repository.

## Table A - all 12 tools, in registration order

Registration order: `src/mcp-tools.js:1616-2112` (the `uiTool(...)` calls inside
`registerTools()`). Condition column: "always" (registered unconditionally) or "consult"
(`if (consultAllowed)`, `src/mcp-tools.js:1744`). Over HTTP, `consultAllowed` is
`consultAllowedFor(profile)` (`src/routes/mcp.js:139`, `:163`) = `config.tenancy.consultEnabled
=== true && config.tenancy.assistantContextEnabled === true && profile?.allowConsult === true`
(`src/consult/gate.js:19-25`).

| name | title | condition | readOnlyHint | destructiveHint | openWorldHint | idempotentHint |
|---|---|---|---|---|---|---|
| prepare_call | Preview a phone call | always | true | false | false | true |
| place_call | Place a phone call | always | false | true | true | false |
| await_call_event | Wait for call update | consult | false | false | false | true |
| answer_consult | Answer call question | consult | false | true | true | false |
| get_call_status | Get call status | always | true | false | false | - |
| get_call_result | Get call result | always | true | false | false | - |
| cancel_call | Cancel a call | always | false | true | true | true |
| get_agent_number | Agent phone number | always | true | false | false | - |
| list_calls | List calls | always | true | false | false | - |
| check_inbox | Check inbox | always | false | false | false | false |
| list_action_items | List action items | always | true | false | false | - |
| get_agent_status | Get agent status | always | true | false | false | - |

`-` = hint not set. The values come from `TOOL_ANNOTATIONS` (`src/mcp-tools.js:1085-1172`), the
single source every registration draws from (each `uiTool(...)` call sets `annotations: TOOL_ANNOTATIONS.<name>`, e.g. `src/mcp-tools.js:1620`); the title is
`annotations.title` and is also emitted as the top-level `title` (`src/mcp-tools.js:1224-1233`).

Machine-readable block (`name|title|condition|readOnlyHint|destructiveHint|openWorldHint|idempotentHint`):

```text
TABLE-A-BEGIN
prepare_call|Preview a phone call|always|true|false|false|true
place_call|Place a phone call|always|false|true|true|false
await_call_event|Wait for call update|consult|false|false|false|true
answer_consult|Answer call question|consult|false|true|true|false
get_call_status|Get call status|always|true|false|false|-
get_call_result|Get call result|always|true|false|false|-
cancel_call|Cancel a call|always|false|true|true|true
get_agent_number|Agent phone number|always|true|false|false|-
list_calls|List calls|always|true|false|false|-
check_inbox|Check inbox|always|false|false|false|false
list_action_items|List action items|always|true|false|false|-
get_agent_status|Get agent status|always|true|false|false|-
TABLE-A-END
```

### Renamed tools

Two tools were renamed for clarity; both are breaking changes (no alias, no silent
forwarding of the old name).

| old name | new name | why |
|---|---|---|
| get_transcript | get_call_result | The tool never returned a transcript - it returns a result summary and whether the objective was achieved. The old name promised content the tool never delivered. |
| get_my_number | get_agent_number | "my" suggested the caller's own number; the tool returns the phone agent's number instead. |

### Removed tools

| name | why |
|---|---|
| get_calendar | Showed demo calendar data, not a real calendar - no consumer ever wrote to it. Removed rather than fixed. |

### Annotation reasoning

OpenAI requires `readOnlyHint`, `destructiveHint` and `openWorldHint` on every tool. The MCP
specification lists all annotation fields as optional (in the MCP SDK's
`ToolAnnotationsSchema`, every field is `.optional()`); where the two differ, Hermes follows
OpenAI and sets all three on all 12 tools, including `destructiveHint: false` on the read-only
tools (`src/mcp-tools.js:1044-1048`). `idempotentHint` is optional in both; Hermes sets it only on
tools that write (`src/mcp-tools.js:1048-1050`) - per the MCP specification it is meaningful only
when `readOnlyHint` is false. The hints are hints; each tool's `description` states its effects
in full.

**The `openWorldHint` rule.** OpenAI defines the hint as follows. Apps SDK reference
(<https://developers.openai.com/apps-sdk/reference>, annotations table): "Declare that the tool
accesses the public internet or open-ended external entities, including through read-only
actions such as web search. A bounded private account or workspace isn't open-world solely
because it is externally hosted." Remote MCP server review requirements
(<https://developers.openai.com/plugins/deploy/app-review>): "Set to `true` if the tool accesses
the public internet or open-ended external entities. This includes read-only tools such as web
search and write tools that post to public platforms, send messages to external recipients,
publish content, push code, or submit forms. Set to `false` if the tool is limited to a bounded
private account or workspace, even when that service is externally hosted."

Hermes applies it as three statements, and every value in Table A follows from one of them:

- **O1** - A tool is `true` when it contacts an external party itself: it dials an outside phone
  number or sends a request to the external telephony provider.
- **O2** - A tool is also `true` when what it writes is sent on to an external recipient: the
  write lands in Hermes' own store, but the content is passed to the phone agent during a live
  call and can reach the person on the other end through what the agent says.
- **O3** - Every other tool is `false`: it only reads or writes Hermes' own per-account store,
  and nothing it reads or writes leaves Hermes. This holds even when the data is about a phone
  call with an outside party - the hint is decided by what the tool reaches, not by what its
  data is about.

The hint describes what a tool can do, not what every single invocation does: a tool that sends
to an external party on at least one path is `true`, even if some invocations send nothing.

- **prepare_call** (registered `src/mcp-tools.js:1616`, handler `:1608-1640`, REST
  `POST /api/call-confirmations`). Previews an outbound call and, when card confirmation is
  switched on for the server, attaches a single-use confirmation code for the Hermes card that
  `place_call` then requires - see "Confirmation before placing a call" below. The server does
  not detect whether the connected client actually renders the card.
  - `readOnlyHint: true` - it never starts a call, never writes to the call store and never
    calls `audit()`; it only derives a code from the request and returns it.
  - `destructiveHint: false` - nothing it does can be undone because nothing durable happens:
    no call record, no billing, no third-party contact.
  - `openWorldHint: false` (O3) - it reaches only Hermes' own confirmation endpoint; it never
    dials and never contacts the telephony carrier.
  - `idempotentHint: true` - repeating the call has no additional effect on the world: no
    call, no record, no cost. It does NOT mean the code is always the same: until a code has
    been used, repeating `prepare_call` with the same arguments in the same five-minute
    window returns the same code; once that code has been used to place a call, repeating
    `prepare_call` returns a new code.
- **place_call** (registered `src/mcp-tools.js:1667`, handler `:1680-1724`, REST
  `POST /api/calls`). As of this inventory, `place_call` additionally REQUIRES a
  `confirmation_code` from a preceding `prepare_call` call with identical arguments - see
  "Confirmation before placing a call" below. The annotations below are unchanged by that
  requirement: they describe what happens once the call IS placed.
  - `readOnlyHint: false` - it starts a real outbound phone call by the AI agent.
  - `destructiveHint: true` - the call reaches a real person, is billed per minute to the
    account, and cannot be undone once placed (its description says "NOT reversible once
    placed").
  - `openWorldHint: true` (O1) - it dials an external phone number through the telephony
    carrier.
  - `idempotentHint: false` - repeating the call for a number that has a call in progress
    returns that same call (`deduplicated: true`, stated in the description), but only while
    that call is running; a repeat after it has ended places a new, separately billed call
    (`src/mcp-tools.js:1065-1069`).
- **await_call_event** (registered `src/mcp-tools.js:1745`, REST `GET /api/calls/:id/consult`,
  `src/routes/api-calls.js:658-682`).
  - `readOnlyHint: false` - each call writes to the call record: it sets the call's "client
    last polled" timestamp to the current time (`noteConsultPoll`, `src/store/state-ops.js:1677-1680`,
    called at `src/routes/api-calls.js:667`), and when it returns a question it records the time
    that question was first delivered (`markConsultAskDelivered`,
    `src/store/state-ops.js:1621-1630`, called at `src/routes/api-calls.js:679-680`). Its
    description says so ("Each call also writes to the call record ...").
  - `destructiveHint: false` - both writes only record that a client is polling and that a
    question reached it. Neither deletes or changes anything the user or the call produced, and
    nothing leaves Hermes. The poll timestamp is what tells the server that a client is
    listening, so that the agent may ask a question during the call
    (`src/consult/in-call.js:71-73`).
  - `openWorldHint: false` (O3) - it reads and writes only the account's own call record; it
    does not contact the carrier or the person on the call, and the two timestamps it writes
    are not passed on to anyone.
  - `idempotentHint: true` - the delivery time of a question is set once and never moved
    (`src/store/state-ops.js:1626`). The only write that happens on every call is the poll
    timestamp, which each call overwrites with the current time (`src/store/state-ops.js:1679`);
    it is kept in memory only and not saved (`src/store/json.js:749-759`,
    `src/store/pg.js:453-460`). A repeated identical call therefore refreshes that one
    timestamp and adds nothing else.
- **answer_consult** (registered `src/mcp-tools.js:1774`, REST
  `POST /api/calls/:id/consult/answer`, `src/routes/api-calls.js:690-714`).
  - `readOnlyHint: false` - with `status="final"` it adds the answers to the running call's
    background facts (`mergeContextFacts`, `src/store/state-ops.js:1325-1335`, applied at
    `:1387`) and marks the question answered (`:1388-1391`); with `status="working"` it records
    an acknowledgement time on the question (`ackConsult`, `src/store/state-ops.js:1637-1643`).
  - `destructiveHint: true` - the answer goes to the phone agent while it is on a live call
    with a third party. It reaches the agent as background information (the description:
    "Answers reach the agent as background information only"), can influence what the agent
    then says to the other person, and cannot be withdrawn once given.
  - `openWorldHint: true` (O2) - the write itself goes to Hermes' own call record, but the
    answer is passed to the phone agent during the live call and can reach an external
    recipient: the person on the phone, through what the agent says.
  - `idempotentHint: false` - this is the conservative value (it is also the MCP default). It is
    not a claim that a repeat has a second effect: a repeated identical final answer is refused
    (HTTP 409 `already_answered`, `src/store/state-ops.js:1363-1364`, `:1373-1375`,
    `src/routes/api-calls.js:193`); the tool then returns `accepted: false` and adds nothing
    (`src/mcp-tools.js:1827-1830`). A repeated `status="working"` acknowledgement is accepted and
    changes nothing (`src/store/state-ops.js:1640`). A repeat does return a different result
    than the first call (`accepted: false` instead of `true`).
- **get_call_status** (registered `src/mcp-tools.js:1869`, REST `GET /api/calls/:id`,
  `src/routes/api-read.js:98-107`).
  - `readOnlyHint: true`, `destructiveHint: false` - it reads the call record and writes
    nothing.
  - `openWorldHint: false` (O3) - it reads only the account's own store; it reports on a call
    but does not contact the carrier or the other party.
  - `idempotentHint` not set - read-only tool.
- **get_call_result** (registered `src/mcp-tools.js:1899`, REST `GET /api/calls/:id`).
  - `readOnlyHint: true`, `destructiveHint: false` - it reads the same call record as
    get_call_status and returns the result summary; it never returns the raw transcript and
    writes nothing.
  - `openWorldHint: false` (O3) - own store only.
  - `idempotentHint` not set - read-only tool.
- **cancel_call** (registered `src/mcp-tools.js:1953`, REST `POST /api/calls/:id/cancel`,
  `src/routes/api-calls.js:717-772`).
  - `readOnlyHint: false`, `destructiveHint: true` - for a running call it marks the call record
    cancelled, stops billing right away, and attempts a hang-up where the call path allows it.
    The cancellation cannot be reversed. As its description says, whether the phone line itself
    actually drops is not guaranteed on every call path; when it is not confirmed, the response
    says so (`line_hangup_confirmed: false`, `src/routes/api-calls.js:764-770`) instead of
    claiming a clean hang-up. On a call path where no hang-up could be attempted at all (a call
    handled through the voice-agent path whose conversation handle is not yet known), the
    response says that too (`hangup_attempted: false`, `src/routes/api-calls.js:769`).
  - `openWorldHint: true` (O1) - where the call path allows it, it sends a hang-up request to
    an external party (the telephony provider or the voice-agent provider). On the path where no
    attempt is possible it sends nothing, but the hint describes what the tool can do, not every
    invocation (see the rule above).
  - `idempotentHint: true` - for a call that is no longer running, the route only returns the
    call's current status and does nothing else (`src/routes/api-calls.js:721`); a repeat is a
    no-op, not an error.
- **get_agent_number** (registered `src/mcp-tools.js:1974`, REST `GET /api/state`,
  `src/routes/api-read.js:63-96`).
  - `readOnlyHint: true`, `destructiveHint: false` - it reads the account's agent phone number
    and writes nothing.
  - `openWorldHint: false` (O3) - own store only.
  - `idempotentHint` not set - read-only tool.
- **list_calls** (registered `src/mcp-tools.js:2002`, REST `GET /api/state`).
  - `readOnlyHint: true`, `destructiveHint: false` - it reads the account's recent calls and
    writes nothing; unlike check_inbox it marks nothing as seen.
  - `openWorldHint: false` (O3) - own store only.
  - `idempotentHint` not set - read-only tool.
- **check_inbox** (registered `src/mcp-tools.js:2033`, REST `POST /api/inbox/poll`,
  `src/routes/api-inbox.js:40-54`).
  - `readOnlyHint: false` - in its default mode it marks every entry it returns as seen
    (`inboxSeenAt`, `src/store/state-ops.js:843`); its description calls it "CONSUMING". With
    `include_seen: true` it re-reads seen entries and marks nothing.
  - `destructiveHint: false` - marking an entry seen deletes nothing: the call stays in the
    call history (list_calls) and the entry can be read again with `include_seen: true`. The
    seen-marker itself is permanent - it is set once, and the code has no path that clears it -
    so what is lost is only the entry's "new" status, which is exactly what the description
    announces ("will NOT appear again").
  - `openWorldHint: false` (O3) - own store only.
  - `idempotentHint: false` - one call returns at most 20 unseen entries
    (`INBOX_MAX_ENTRIES`, `src/routes/api-inbox.js:31`) and marks those as seen. An identical
    second call therefore returns and marks the next entries (those reported as `remaining`)
    or calls that ended in between - each repeat can change state further.
- **list_action_items** (registered `src/mcp-tools.js:2058`, REST `GET /api/state`).
  - `readOnlyHint: true`, `destructiveHint: false` - it reads the open action items and writes
    nothing.
  - `openWorldHint: false` (O3) - own store only.
  - `idempotentHint` not set - read-only tool.
- **get_agent_status** (registered `src/mcp-tools.js:2084`, REST `GET /api/state`).
  - `readOnlyHint: true`, `destructiveHint: false` - it reads the agent's number, monthly usage
    and permissions and writes nothing.
  - `openWorldHint: false` (O3) - own store only.
  - `idempotentHint` not set - read-only tool.

### Confirmation before placing a call

`place_call` requires a `confirmation_code` obtained from a preceding `prepare_call` call with
the identical arguments. The server derives the code from a secret operated by Hermes, the
account, a five-minute time window and every argument except the code itself: the normalized
destination, `objective`, `briefing`, `context`, `language`, `max_duration_s`, `constraints`,
`mandate` and `diagnostic` (any argument added later is bound by default). A missing argument,
an empty string and an empty object are distinct values. Changing any argument after the user
confirmed - including only rewording `briefing` or `context` - invalidates the code; the model
has to call `prepare_call` again and the user has to confirm again.
The code is issued only in the tool result's `_meta`, never in the model-visible text or
`structuredContent`.

A code is accepted for at least five and at most ten minutes and only once. Each submitted code
is compared, in constant time, against at most two candidates (the current code of this request
for the current and the previous window). After ten rejected codes for one account within a
five-minute window, every code for that account is rejected until the window ends, including a
correct one. With 32^6 possible codes this keeps the chance of guessing a code by brute force at
roughly 2e-3 per year of guessing at the highest rate this limit allows, per server instance.
The single-use record and
this limit are held in the memory of each server instance: they reset on restart, and with
several instances a used code could be replayed on another instance while it is still valid,
and the guessing limit applies per instance.

A code the same account has already used is answered with its own error result: its
`structuredContent.status` is `confirmation_used` and its text says the call was already sent
and that `place_call` must not be called again for it. The result names neither the code nor the
destination, and it is given only to the account that used the code. This answer does not count
as a failed guess. The card treats it as final: it shows that the confirmation was already sent
and no longer offers a confirm button. The card also remembers a fingerprint of a code it sent
(not the code itself) in its own browser storage when the host allows it, so a reloaded card
that receives the same preview again starts in that state without sending anything. Where the
host blocks that storage, the server answer above is the only safeguard, with the per-instance
limits described in the previous paragraph.

The server does not detect whether the connecting host displays the card or keeps `_meta` from
the model - once card confirmation is enabled, every connecting host receives the code in
`_meta`. The Hermes card widget (its own iframe script, not the model) reads the code from
there and, once the user clicks confirm, calls `place_call` itself over the host's own
tool-call bridge; it then reports the resulting `call_id` back to the model in a chat message.
The model does not call `place_call` for that call itself. On a host that follows the MCP Apps
contract and keeps `_meta` from the model, the code therefore never reaches the model at all -
only a user action (clicking confirm in the rendered card) can place the call. On a host that
does not follow the contract, the code would be model-visible too, and the confirmation would
be formal only: a model could read it from `_meta` and call `place_call` itself, bypassing the
card's user-facing review entirely; Hermes does not claim more than that the code was issued
for exactly these arguments and consumed once. It is not a claim
that a human read the card, and it does not itself authorize the call:
the server's outbound permission checks (subscription/verification, destination country and
number, hourly/per-destination limits, per-account cost cap, maximum duration, provider
signature verification) run unchanged when the call is actually placed, regardless of the
confirmation.

A host that does not display the Hermes card (and keeps `_meta` from the model, as the contract
requires) has no way to place calls through `place_call`: no card was ever rendered to read the
code from, and the model never receives it either. The tool texts tell the model that a
card-confirmed call is placed by the card itself, never by the model, never to guess or invent
a code, and to tell the user honestly when no call can be placed from this host. When card
confirmation is switched off for the server, no client receives a code and no call can be
placed through `place_call` at all.

`cancel_call` and `answer_consult` do not get a second confirmation step. `cancel_call` only
reduces harm - delaying it adds no new cost and starts no new contact. `answer_consult` is
time-critical and only ever runs inside a call that was already confirmed when it was placed; a
card round-trip there would let the call time out.

### Input fields of prepare_call and place_call

Both tools share one input schema (`src/mcp-tools.js:1335`); a change to a field description
applies to both. Length limits per field are enforced server-side
(`src/routes/_validation.js:32-51`); everything else in this section is an instruction to the
model in the field description, not a server-side check.

- `to` - the number to dial; checked by the outbound gates before dialling.
- `objective` - one sentence, read out to the called party right after the AI disclosure.
- `briefing` - only the context this call needs, summarised, no secrets or payment data,
  sensitive details only as needed. It reaches the voice agent on both call paths
  (`src/claude.js`, `src/elevenlabs/outbound.js:665-672`).
- `context` - optional structured background; a subfield is to be filled only when the call
  needs it, without repeating the briefing. It remains a second optional field next to
  `briefing`; the schema does not force the limit. The server accepts it only while the
  assistant-context switch is on: otherwise the outbound gate sets it to null before the call
  is created (`src/telephony/outbound-gates.js:866-867`). When it is accepted, it goes into the
  prompt on the budget path (`src/claude.js:357-367`) and to the voice agent together with the
  briefing on the voice-agent path (`src/elevenlabs/outbound.js:665-672`). Why each subfield is
  needed, as its description states it:
  - `summary` (`src/mcp-tools.js:1431`) - so the agent can state why it calls; 1-3 sentences,
    not a copy of the chat.
  - `key_facts` (`src/mcp-tools.js:1437`) - only facts the agent must state correctly, such as
    names and dates; at most 10 short items, no secrets, passwords or payment data.
  - `recipient_relationship` (`src/mcp-tools.js:1443`) - only when it sets the tone of the call,
    for example a regular customer versus a new one.
  - `desired_outcome` (`src/mcp-tools.js:1447`) - so the agent knows when the call has reached
    its goal.
  - `open_questions` (`src/mcp-tools.js:1451`) - questions only the principal can answer; they
    are asked while the phone is ringing, and only when the account's permission profile
    allows questions to the principal (`src/routes/api-calls.js:424-428`).
- `constraints` and `mandate` - hard limits, and the optional frame within which the agent may
  commit. `mandate.on_out_of_scope` has no effect on the voice-agent path: that path passes on
  only the decision frame, the fallback order and the booking boundary, not this setting
  (`src/elevenlabs/outbound.js:615`, `:622`). Which path handles a call is decided by one
  global switch (`src/config.js:808`, off by default in the code; evaluated in
  `src/routes/api-calls.js:521`); this document makes no claim about the production value.
  On that path, `decline` and `accept_best` are therefore not applied. The field's
  description says only "Not applied on every call path." and does not name the path.
- `language`, `max_duration_s`, `diagnostic` - call settings.
- `confirmation_code` - added to the schema of `place_call` only (`src/mcp-tools.js:1684`);
  it comes from the Hermes card after the user confirms.

Purpose rule. The description of `prepare_call` and the server instructions carry the same
sentence, word for word:

> Place calls only when the user asks for them, for themselves or someone they act for, such as
> booking, rescheduling, enquiring or complaining - not for telemarketing, unsolicited
> advertising or sales calls, political campaigning, or mass or automated dialling of many
> numbers.

The description of `place_call` carries only a short form:

> Not for telemarketing, unsolicited advertising or political campaign calls.

The description of `prepare_call` also says:

> For contracts, loans, insurance, tenancy, employment or legal matters, let decide_freely cover
> appointment times only and do not set 'accept_best', so the agent agrees to no terms there.

These are usage rules for the model. The server does not check the purpose of a call and does
not block a mandate by subject area.

## Table B - tool count and exact name set per configuration

The counts are **measured on the real wire** (HTTP `/mcp` and the stdio child process
`src/mcp-server.js`), not derived from Table A by hand.

| K | transport | identity/profile | switches | count |
|---|---|---|---|---|
| K1 | HTTP | Bootstrap owner (`OWNER_PROFILE`, `src/store/defaults.js:1056-1065`) | Consult + AssistantContext on | 12 |
| K2 | HTTP | Bootstrap owner | Consult off | 10 |
| K3 | HTTP (OAuth) | Account without a stored profile (`DEFAULT_PROFILE`, `src/store/defaults.js:1069-1078`) | Consult on | 10 |
| K4 | HTTP (OAuth) | Account with the paid-plan profile (`planProfileFor("starter")`, `src/plans.js:107-141`, `:154-156`) | Consult on | 12 |
| K5 | HTTP (OAuth) | Account with the same paid-plan profile | Consult off | 10 |
| K6 | stdio (`src/mcp-server.js`) | no account (defaults `consultAllowed = false`, `src/mcp-tools.js:1244-1246`, `:1513`) | not applicable (stdio never registers the consult tools) | 10 |

The count still depends on exactly one thing: whether the consult channel is available.
K1 and K4 both have it and both count 12; K2, K3, K5 and K6 all lack it and all count 10 -
four different reasons (owner with consult switched off, no stored profile, paid plan with
consult switched off, stdio never registers the consult tools) landing on the identical name
set. prepare_call is registered unconditionally, in EVERY configuration.

Machine-readable block (`K|transport|count|comma-separated tool names in Table A order`):

```text
TABLE-B-BEGIN
K1|http|12|prepare_call,place_call,await_call_event,answer_consult,get_call_status,get_call_result,cancel_call,get_agent_number,list_calls,check_inbox,list_action_items,get_agent_status
K2|http|10|prepare_call,place_call,get_call_status,get_call_result,cancel_call,get_agent_number,list_calls,check_inbox,list_action_items,get_agent_status
K3|http-oauth|10|prepare_call,place_call,get_call_status,get_call_result,cancel_call,get_agent_number,list_calls,check_inbox,list_action_items,get_agent_status
K4|http-oauth|12|prepare_call,place_call,await_call_event,answer_consult,get_call_status,get_call_result,cancel_call,get_agent_number,list_calls,check_inbox,list_action_items,get_agent_status
K5|http-oauth|10|prepare_call,place_call,get_call_status,get_call_result,cancel_call,get_agent_number,list_calls,check_inbox,list_action_items,get_agent_status
K6|stdio|10|prepare_call,place_call,get_call_status,get_call_result,cancel_call,get_agent_number,list_calls,check_inbox,list_action_items,get_agent_status
TABLE-B-END
```

## What the reviewer will see

The set of tools a reviewer or user sees depends on which account and transport they connect
with - it is not a fixed catalog:

- The full set of 12 tools is reached by the bootstrap owner account (`OWNER_PROFILE`) with
  both `CONSULT_ENABLED` and `ASSISTANT_CONTEXT_ENABLED` on (K1), and equally by any account on
  a paid plan (`starter` or `business`, `src/plans.js:146-149`) with the consult channel
  available (K4) - the two no longer differ, since `get_calendar` (the one tool that used to
  depend on the account's profile rather than on the consult switch) is gone.
- Every account without the consult channel available - no stored profile, a paid plan with
  consult switched off, or the bootstrap owner with consult switched off - reaches 10.
- The stdio entry point (Claude Desktop, or any local MCP client that launches
  `src/mcp-server.js`) never registers the two consult tools and so always reaches 10. The
  reasons in the code: stdio has no client model that polls (`src/mcp-tools.js:1244-1246`), the
  process calls `registerTools()` without `consultAllowed` (default `false`), and it has no
  store from which an account's consult permission could be resolved
  (`src/mcp-server.js:23-37`).

The **live values of the platform switches** (`CONSULT_ENABLED`, `ASSISTANT_CONTEXT_ENABLED`)
are maintained in the hosting dashboard and are **not** recorded in this document - the
repository's `render.yaml` is not authoritative for them. This document makes no claim about
which values production runs with.

## Why the variance is not resolved in code

The variance is deliberate product behaviour, not a defect, and it comes from exactly two
conditional tools:

- The two consult tools (`await_call_event`, `answer_consult`) are registered only when the
  consult channel is available to the account; otherwise they are not registered at all
  (`src/mcp-tools.js:1741-1744`). The same gate function decides whether the tools are
  registered and - extended by one per-call condition, `consultAllowedForCall`
  (`src/consult/gate.js:41-43`) - whether the channel is offered on a live call. Registering
  tools whose channel cannot work would put tools into `tools/list` that the account cannot
  use.

This "not registered rather than refused" rule applies **only** to these two tools. Every
other tool is registered for every account, and permission is enforced when the tool is
called. In particular, `place_call` is registered even for accounts that may not place outbound
calls at all - an account without a stored profile (its outbound limit is 0 calls per hour,
`src/store/defaults.js:1042-1046`, `:1077`; measured: `place_call` is in K3's `tools/list`) or an
account without an active subscription and completed verification. For those accounts a
`place_call` request is refused with an error by the server-side outbound safety gates, before
any call is placed; its description says that disallowed destinations are refused by the server
with a clear message.

The transport does not add a further axis: there is only one renderer for every host
(the ChatGPT-/Skybridge adapter is removed), and it shares the exact same tool registration -
`enableWidgetUi` only changes per-tool `_meta`, never which tools exist
(`src/mcp-tools.js:1556-1563`).
