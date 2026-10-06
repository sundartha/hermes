import { z } from "zod";
import { uiRendererFor } from "./ui/registry.js";
import { UI_META_KEY } from "./ui/contract.js";
import { WIDGET_LOCALE_META_KEY } from "./ui/widget-i18n.js";
import { WIDGET_AGENT_STATUS } from "./ui/adapters/mcp-native.js";
import {
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALL,
} from "./ui/widget-catalog.js";
import {
  MAX_CALL_DURATION_CAP_S,
  MANDATE_OUT_OF_SCOPE_VALUES,
  KEY_FACTS_LIMITS,
  CONSULT_ANSWER_MODE,
} from "./store/defaults.js";
import { CONSULT_EVENT, CONSULT_POLL_ABORT_MS } from "./consult/delivery.js";
import { resolveGatewayUrl } from "./config.js";
import { resultCardView } from "./call-result.js";
import { localeFor, SUPPORTED_LANGUAGES } from "./i18n/locales.js";
import { MCP_ERROR_CODE, MCP_TEXTS } from "./i18n/mcp-texts.js";
import { RESTRICTED_CATEGORY, firstRestrictedField, maskRestrictedText } from "./restricted-data.js";
import { failureReasonBase } from "./telephony/failure-reason.js";
import { CALL_PURPOSE_RULE, CALL_PURPOSE_SHORT_RULE } from "./mcp-server-info.js";
import { CONFIRMATION_ALREADY_USED_REASON } from "./call-confirmation.js";

const LAST_TRANSCRIPT_LINES = 6;

const BAD_REQUEST_STATUS = 400;

async function api({ method, path, body, identity, scopedTenant, timeoutMs = null }) {
  const headers = { "Content-Type": "application/json" };
  if (identity) headers["X-Internal-Identity"] = identity;
  if (scopedTenant) headers["X-Internal-Tenant"] = scopedTenant;
  const res = await fetch(resolveGatewayUrl() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("upstream_status");
    err.httpStatus = res.status;
    if (typeof json.reason === "string") err.reason = json.reason;
    else if (res.status === BAD_REQUEST_STATUS && typeof json.error === "string")
      err.inputHint = json.error;
    throw err;
  }
  return json;
}

const text = (s) => ({
  content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }],
});
const errText = (s) => ({ content: [{ type: "text", text: s }], isError: true });
const makeDateFormatter = (dateLocale) => (iso) =>
  new Date(iso).toLocaleString(dateLocale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

class ToolError extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field;
  }
}

function requireFields(obj, specs) {
  if (obj == null || typeof obj !== "object") throw new ToolError(MCP_ERROR_CODE.UPSTREAM_INVALID);
  for (const [field, type] of Object.entries(specs)) {
    const v = obj[field];
    const ok =
      type === "array"
        ? Array.isArray(v)
        : type === "object"
          ? v != null && typeof v === "object"
          : typeof v === type;
    if (!ok) throw new ToolError(MCP_ERROR_CODE.UPSTREAM_INCOMPLETE);
  }
  return obj;
}

export function mapStatus(c) {
  if (c.status === "active") return c.answeredAt ? "in_progress" : "dialing";
  return c.status;
}
function durationS(c) {
  const start = c.startedAt;
  const end = c.endedAt || new Date().toISOString();
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}

function callOutcomeView(call) {
  return { status: mapStatus(call), failure_reason: failureReasonBase(call.failureReason) };
}

function pickCallStatus(callId, c, texts) {
  return {
    call_id: callId,
    ...callOutcomeView(c),
    duration_s: durationS(c),
    last_transcript_lines: c.transcript
      .slice(-LAST_TRANSCRIPT_LINES)
      .map((t) => maskRestrictedText(`${t.role === "agent" ? texts.roleAgent : texts.roleCounterparty}: ${t.text}`)),
  };
}

const CALL_STATUS_OUTPUT = {
  call_id: z.string(),
  status: z.string(),
  duration_s: z.number(),
  last_transcript_lines: z.array(z.string()),
  failure_reason: z.string().nullable(),
};

const AWAIT_SUMMARY_PLACEHOLDER =
  "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";

export function pickTranscript(callId, c, texts = null) {
  const failureSummary =
    texts && mapStatus(c) === "failed" ? texts.callFailedSummary(c.failureReason) : null;
  return {
    call_id: callId,
    result_summary: maskRestrictedText(c.summary || failureSummary || AWAIT_SUMMARY_PLACEHOLDER),
    objective_achieved: c.objectiveAchieved ?? "unclear",
    ...maskedResultCard(c.result),
  };
}

function maskResultCardFields(card) {
  return {
    outcome: maskRestrictedText(card.outcome),
    commitments: card.commitments.map(maskRestrictedText),
    counterparty_commitments: card.counterparty_commitments.map(maskRestrictedText),
    open_points: card.open_points.map(maskRestrictedText),
    next_step: maskRestrictedText(card.next_step),
  };
}

function maskedResultCard(result) {
  return maskResultCardFields(resultCardView(result));
}

const RESULT_CARD_OUTPUT = {
  outcome: z.string().nullable(),
  commitments: z.array(z.string()),
  counterparty_commitments: z.array(z.string()),
  open_points: z.array(z.string()),
  next_step: z.string().nullable(),
};

const CALL_RESULT_OUTPUT = {
  call_id: z.string(),
  result_summary: z.string(),
  objective_achieved: z.union([z.boolean(), z.string()]),
  ...RESULT_CARD_OUTPUT,
};

const AWAIT_EVENT_OUTPUT = {
  event: z.string(),
  event_id: z.string().nullable(),
  questions: z.array(z.string()),
  status: z.string().nullable(),
  failure_reason: z.string().nullable(),
  result_summary: z.string().nullable(),
  objective_achieved: z.union([z.boolean(), z.string()]).nullable(),
  ...RESULT_CARD_OUTPUT,
};

function awaitEventView({ callId, event, finished, texts }) {
  const done = finished ? pickTranscript(callId, finished, texts) : null;
  const outcome = finished ? callOutcomeView(finished) : { status: null, failure_reason: null };
  return {
    event: event.event,
    event_id: event.eventId ?? null,
    questions: Array.isArray(event.questions) ? event.questions.map(maskRestrictedText) : [],
    ...outcome,
    result_summary: done?.result_summary ?? null,
    objective_achieved: done?.objective_achieved ?? null,
    ...maskedResultCard(finished?.result),
  };
}

const ANSWER_CONSULT_OUTPUT = {
  accepted: z.boolean(),
  merged_facts: z.number(),
};

const CONSULT_ANSWER_REJECTED_STATUS = 400;
const CONSULT_ANSWER_CONFLICT_STATUS = 409;

const ABORT_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);
const isAbortError = (err) => ABORT_ERROR_NAMES.has(err?.name);

export const PLACE_CALL_HOP_TIMEOUT_MS = 180000;

export const MCP_HOP_TIMEOUT_MS = 60000;

async function boundedHop(request) {
  try {
    return await api({ ...request, timeoutMs: MCP_HOP_TIMEOUT_MS });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.HOP_TIMEOUT);
    throw err;
  }
}

const NOT_FOUND_STATUS = 404;
const NOT_PERMITTED_STATUS = 403;
const CLIENT_ERROR_STATUS_MIN = 400;
const CLIENT_ERROR_STATUS_MAX = 499;
const SERVER_ERROR_STATUS_MIN = 500;
const SERVER_ERROR_STATUS_MAX = 599;
const HTTP_SERVICE_UNAVAILABLE_STATUS = 503;
const CONFIRMATION_UNAVAILABLE_REASON = "confirmation_unavailable";

function isServerErrorWithoutReason(err) {
  return (
    typeof err?.reason !== "string" &&
    typeof err?.httpStatus === "number" &&
    err.httpStatus >= SERVER_ERROR_STATUS_MIN &&
    err.httpStatus <= SERVER_ERROR_STATUS_MAX
  );
}

async function placeCallHop({ identity, scopedTenant, body }) {
  try {
    return await api({
      method: "POST",
      path: "/api/calls",
      body,
      identity,
      scopedTenant,
      timeoutMs: PLACE_CALL_HOP_TIMEOUT_MS,
    });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.CALL_START_UNCONFIRMED);
    if (isServerErrorWithoutReason(err)) throw new ToolError(MCP_ERROR_CODE.CALL_START_REJECTED);
    throw err;
  }
}

function isConfirmationUnavailable(err) {
  return err?.httpStatus === HTTP_SERVICE_UNAVAILABLE_STATUS && err?.reason === CONFIRMATION_UNAVAILABLE_REASON;
}

const RESTRICTED_CATEGORY_ERROR_CODE = Object.freeze({
  [RESTRICTED_CATEGORY.PAYMENT_CARD]: MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD,
  [RESTRICTED_CATEGORY.GOVERNMENT_ID]: MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID,
  [RESTRICTED_CATEGORY.CREDENTIAL_SECRET]: MCP_ERROR_CODE.RESTRICTED_CREDENTIAL,
});

const CALL_ARGS_EXEMPT_KEYS = Object.freeze(["to", "confirmation_code", "language"]);

function rejectRestrictedData(body, exemptKeys) {
  const hit = firstRestrictedField(body, exemptKeys);
  if (hit) throw new ToolError(RESTRICTED_CATEGORY_ERROR_CODE[hit.category], hit.field);
}

async function confirmCallHop({ identity, scopedTenant, body }) {
  rejectRestrictedData(body, CALL_ARGS_EXEMPT_KEYS);
  try {
    return await api({
      method: "POST",
      path: "/api/call-confirmations",
      body,
      identity,
      scopedTenant,
      timeoutMs: MCP_HOP_TIMEOUT_MS,
    });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.HOP_TIMEOUT);
    if (isConfirmationUnavailable(err)) throw new ToolError(MCP_ERROR_CODE.CONFIRMATION_UNAVAILABLE);
    throw err;
  }
}

const DENIAL_WARN_MAX_LEN = 40;

function sanitizedDenialReason(reason) {
  return String(reason)
    .toLowerCase()
    .replace(/[^a-z_]/g, "")
    .slice(0, DENIAL_WARN_MAX_LEN);
}

function knownToolErrorCodeText(err, texts) {
  const entry = err?.code ? texts.errors[err.code] : undefined;
  return typeof entry === "function" ? entry(err.field) : entry;
}

function denialReasonText(err, texts) {
  if (typeof err?.reason !== "string") return undefined;
  const denialText = texts.denials[err.reason];
  if (denialText) return denialText;
  console.warn("[mcp] unbekannter Ablehnungsgrund:", sanitizedDenialReason(err.reason));
  return texts.errors[MCP_ERROR_CODE.DENIAL_UNKNOWN];
}

function httpStatusClassText(httpStatus, texts) {
  if (httpStatus === NOT_FOUND_STATUS) return texts.errors[MCP_ERROR_CODE.NOT_FOUND];
  if (httpStatus === NOT_PERMITTED_STATUS) return texts.errors[MCP_ERROR_CODE.NOT_PERMITTED];
  const isClientError =
    typeof httpStatus === "number" &&
    httpStatus >= CLIENT_ERROR_STATUS_MIN &&
    httpStatus <= CLIENT_ERROR_STATUS_MAX;
  return isClientError ? texts.errors[MCP_ERROR_CODE.REQUEST_REJECTED] : undefined;
}

function resolvedToolErrorText(err, texts) {
  const known = knownToolErrorCodeText(err, texts);
  if (known) return known;
  const denial = denialReasonText(err, texts);
  if (denial) return denial;
  if (typeof err?.inputHint === "string") return err.inputHint;
  const statusText = httpStatusClassText(err?.httpStatus, texts);
  if (statusText) return statusText;
  console.error("[mcp] Tool-Fehler ohne bekannte Kennung:", err?.name, err?.message);
  return texts.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];
}

const LAST_RESORT_ERROR_TEXT = MCP_TEXTS.en.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];

function withTextTables(texts) {
  return { errors: texts?.errors ?? {}, denials: texts?.denials ?? {} };
}

function isNonEmptyText(text) {
  return typeof text === "string" && text.trim() !== "";
}

export function toolErrorText(err, texts) {
  const text = resolvedToolErrorText(err, withTextTables(texts));
  return isNonEmptyText(text) ? text : LAST_RESORT_ERROR_TEXT;
}

const NO_CONSULT_EVENT = Object.freeze({
  event: CONSULT_EVENT.NONE,
  eventId: null,
  questions: [],
});

const notAccepted = (message) => ({
  content: [{ type: "text", text: message }],
  structuredContent: { accepted: false, merged_facts: 0 },
});

const CONTEXT_RECEIVED_OUTPUT = z.object({
  active: z.boolean(),
  summary: z.boolean(),
  key_facts_count: z.number(),
  recipient_relationship: z.boolean(),
  desired_outcome: z.boolean(),
});

const CALL_OUTPUT = {
  ...CALL_STATUS_OUTPUT,
  result_summary: z.string().nullable(),
  objective_achieved: z.union([z.boolean(), z.string()]).nullable(),
  context_received: CONTEXT_RECEIVED_OUTPUT,
  deduplicated: z.boolean(),
};

function normalizeContextReceived(cr) {
  return {
    active: !!cr?.active,
    summary: !!cr?.summary,
    key_facts_count: typeof cr?.key_facts_count === "number" ? cr.key_facts_count : 0,
    recipient_relationship: !!cr?.recipient_relationship,
    desired_outcome: !!cr?.desired_outcome,
  };
}

const PREPARE_CALL_OUTPUT = {
  status: z.string(),
  to: z.string(),
  objective: z.string(),
  language: z.string().optional(),
  max_duration_s: z.number().optional(),
  briefing: z.string().optional(),
  constraints: z.string().optional(),
  mandate: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  diagnostic: z.boolean().optional(),
};

function permissionsSummary(settings, labels) {
  return (
    `${labels.summaries}=${settings.allowSummaries}, ${labels.personalData}=${settings.allowPersonalData}, ` +
    `${labels.bankData}=${settings.allowBankData}`
  );
}

function pickAgentStatus(s, texts) {
  return {
    number: s.agent.number ?? null,
    owner: s.agent.owner ?? null,
    calls: s.usage.calls,
    planUsagePercent: s.usage.planUsagePercent ?? null,
    permissions: permissionsSummary(s.settings, texts.permissionLabels),
  };
}

const AGENT_STATUS_OUTPUT = {
  number: z.string().nullable(),
  owner: z.string().nullable(),
  calls: z.number(),
  planUsagePercent: z.number().nullable(),
  permissions: z.string(),
};

function pickMyNumber(s) {
  return { number: s.agent.number ?? null };
}
const MY_NUMBER_OUTPUT = { number: z.string().nullable() };

function pickCall(c, formatDate) {
  const entry = {
    id: c.id,
    direction: c.direction,
    counterparty: (c.direction === "outbound" ? c.to : c.from) ?? null,
    status: mapStatus(c),
    startedAt: formatDate(c.startedAt),
  };
  if (c.summary) entry.summary = maskRestrictedText(c.summary);
  return entry;
}
const CALL_LIST_ENTRY = z.object({
  id: z.string(),
  direction: z.string(),
  counterparty: z.string().nullable(),
  status: z.string(),
  startedAt: z.string(),
  summary: z.string().optional(),
});
const CALLS_OUTPUT = { calls: z.array(CALL_LIST_ENTRY) };

function callTextLine(e) {
  const arrow = e.direction === "outbound" ? "->" : "<-";
  return `[${e.id}] ${arrow} ${e.counterparty} | ${e.status} | ${e.startedAt}${e.summary ? " | " + e.summary : ""}`;
}

const INBOX_ENTRY = z.object({
  call_id: z.string(),
  caller: z.string().nullable(),
  at: z.string().nullable(),
  summary: z.string().nullable(),
  summary_unavailable: z.boolean(),
  ...RESULT_CARD_OUTPUT,
  action_items: z.array(z.string()),
  action_required: z.boolean(),
});
const INBOX_OUTPUT = { entries: z.array(INBOX_ENTRY), remaining: z.number() };

function inboxEntryForModel(entry, formatDate) {
  const { started_at: startedAt, ...rest } = entry;
  return {
    ...rest,
    ...maskResultCardFields(rest),
    at: startedAt ? formatDate(startedAt) : null,
    summary: maskRestrictedText(rest.summary),
    action_items: rest.action_items.map(maskRestrictedText),
  };
}

function inboxTextLine(entry, texts) {
  const summaryText = entry.summary ?? texts.inboxSummaryUnavailable;
  const actions = entry.action_items.map((item) => `\n  - ${item}`).join("");
  return `[${entry.call_id}] ${entry.caller} | ${entry.at} | ${summaryText}${actions}`;
}

function actionItemsText(items, texts) {
  return items
    .map(
      (item) =>
        `${item.type === "appointment" ? texts.appointmentPrefix : ""}${maskRestrictedText(item.text)}`,
    )
    .join("\n");
}

const CHECK_INBOX_DESCRIPTION =
  "Check the call inbox: inbound calls that finished since the last check - who called, " +
  "what they wanted, what was promised, and what to do now. CONSUMING: entries returned " +
  "here are marked as seen and will NOT appear again. Do NOT use this to browse or re-read " +
  "call history - use list_calls for that.";

const INCLUDE_SEEN_FIELD = z
  .boolean()
  .optional()
  .describe("Re-read entries that were already marked as seen. Changes NO marker.");

const OPEN_QUESTIONS_FIELD = z
  .array(z.string())
  .optional()
  .describe(
    "A few (max. 10) short questions that are still open BEFORE the call and that only the principal can answer. They are asked while the phone is ringing, so the agent starts the conversation with the answers.",
  );

const PLACE_CALL_DESCRIPTION =
  "REQUIRES a confirmation_code that only the Hermes card can supply - call prepare_call FIRST with the same arguments so the user can confirm there; once they do, the card places the call itself and reports the call_id back in a chat message, so you never call this tool for that call and never guess or invent its code. Without a code from the card the call is NOT placed. Starts a real phone call by the AI agent to a phone number, pursuing the given objective, and is NOT reversible once placed; billed per minute to the caller's account. Which destinations are allowed is decided by the server through its safety gates (permission profile/allowlist, denylist, country, limits). A live-updating card is NOT guaranteed on every host - ALWAYS track the call via the call_id from that chat message, using get_call_status until it reports a final status. " + CALL_PURPOSE_SHORT_RULE;

const PREPARE_CALL_DESCRIPTION =
  `Prepares a phone call for confirmation WITHOUT placing it: no cost, no call, nothing irreversible. Takes the exact same arguments as place_call. When card confirmation is switched on for this server, the host can show a Hermes card where the user reviews and confirms the call; if they confirm, the card places the call itself with the confirmation code and reports the call_id back in a chat message - you never call place_call for that call, and never guess or invent its code. The confirmation covers every argument, briefing and context included. If this host does not show the Hermes card, or card confirmation is switched off for this server, no call can be placed from here - tell the user so honestly and do not ask them for a code they cannot see. Call prepare_call again EVERY time any argument changes or a confirmation expired, and let the user confirm again. ${CALL_PURPOSE_RULE} For contracts, loans, insurance, tenancy, employment or legal matters, let decide_freely cover appointment times only and do not set 'accept_best', so the agent agrees to no terms there.`;

const PLACE_CALL_CONSULT_LOOP =
  "Right after this call returns, start calling await_call_event with the returned call_id and keep calling it until it returns event=\"done\" - if the agent runs into a detail the briefing left open, its question reaches you only inside this loop, and it can ask at most once, so answer it straight away. Place the call with what you have: an open detail costs nothing, a guessed one cannot be taken back.";

const placeCallDescription = (consultLoop) =>
  [PLACE_CALL_DESCRIPTION, consultLoop ? PLACE_CALL_CONSULT_LOOP : null].filter(Boolean).join(" ");

const CANCEL_CALL_DESCRIPTION =
  "Cancels the call record and stops billing right away. Whether the phone line itself actually drops is NOT guaranteed on every call path - when it is not, the response says so explicitly instead of claiming a clean hangup.";

const AWAIT_CALL_EVENT_DESCRIPTION =
  "Waits briefly (up to ~20 seconds) for the next event of a running call and returns " +
  "either a question from the agent, the final result, or nothing. Call this REPEATEDLY " +
  "right after place_call and keep going until it returns event=\"done\" - that final " +
  "answer carries the complete result (summary and whether the objective was achieved), " +
  "so there is no need to call get_call_result separately. event=\"none\" simply means " +
  "nothing happened yet: call it again. This tool NEVER returns audio. Each call also " +
  "writes to the call record: it notes that you polled and marks a pending question as " +
  "delivered. Pass after_event_id so you do not receive the same question twice.";

const CALL_RESULT_DESCRIPTION =
  "After the call has ended, returns call_id, result_summary, objective_achieved and the " +
  "result card: outcome, commitments, counterparty_commitments, open_points, next_step. " +
  "This tool NEVER returns the raw transcript - whether the server keeps it afterwards on " +
  "its own follows the diagnostic rule of place_call's diagnostic field and is independent " +
  "of this response. Call this once get_call_status reports a final status - completed, " +
  "failed or cancelled, not only completed - it carries the result summary for those too.";

const AGENT_STATUS_DESCRIPTION =
  "Returns the status of the phone agent with these fields: number (the agent's phone " +
  "number, or null), owner (the account owner's name, or null), calls (number of calls so " +
  "far), planUsagePercent (share of the monthly minute quota used, in percent, or null if " +
  "no quota is set), permissions (what the agent may share: summaries, personal data, bank " +
  "data).";

const ANSWER_CONSULT_DESCRIPTION =
  "Answers a question the phone agent asked during a running call. " +
  "FIRST, the moment you receive the question, call this tool once with " +
  'status="working" and no answers - that tells the agent someone is on it. ' +
  'THEN send the real answer with status="final" (the default). ' +
  "Give SHORT factual answers - one entry per question, each at most " +
  KEY_FACTS_LIMITS.maxLen +
  " characters; longer answers are REJECTED and the question stays open. Do NOT invent " +
  "facts: if you do not know, say so honestly here instead of guessing. Answers reach " +
  "the agent as background information. The agent may relay your answer to the person " +
  "on the call.";

const TOOL_ANNOTATIONS = {
  prepare_call: {
    title: "Preview a phone call",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  place_call: {
    title: "Place a phone call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  await_call_event: {
    title: "Wait for call update",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  answer_consult: {
    title: "Answer call question",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  get_call_status: {
    title: "Get call status",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  get_call_result: {
    title: "Get call result",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  cancel_call: {
    title: "Cancel a call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  get_agent_number: {
    title: "Agent phone number",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  list_calls: {
    title: "List calls",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  check_inbox: {
    title: "Check inbox",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  list_action_items: {
    title: "List action items",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  get_agent_status: {
    title: "Get agent status",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const OPENAI_INVOKING_KEY = "openai/toolInvocation/invoking";
const OPENAI_INVOKED_KEY = "openai/toolInvocation/invoked";
const TOOL_INVOCATION_STATUS = {
  prepare_call: { invoking: "Preparing the call for confirmation", invoked: "Call preview ready" },
  place_call: { invoking: "Placing the call", invoked: "Call started" },
  await_call_event: {
    invoking: "Waiting for the next call event",
    invoked: "Call event received",
  },
  answer_consult: {
    invoking: "Sending your answer to the agent",
    invoked: "Answer delivered",
  },
  get_call_status: { invoking: "Checking the call status", invoked: "Call status read" },
  get_call_result: { invoking: "Reading the call result", invoked: "Call result read" },
  cancel_call: { invoking: "Cancelling the call", invoked: "Cancellation requested" },
  get_agent_number: { invoking: "Looking up the agent number", invoked: "Agent number read" },
  list_calls: { invoking: "Listing recent calls", invoked: "Recent calls listed" },
  check_inbox: { invoking: "Checking the call inbox", invoked: "Inbox checked" },
  list_action_items: {
    invoking: "Listing open action items",
    invoked: "Action items listed",
  },
  get_agent_status: { invoking: "Checking the agent status", invoked: "Agent status read" },
};

const withOpenAiToolMetadata = (name, config) => {
  const status = TOOL_INVOCATION_STATUS[name];
  const statusMeta = status
    ? { [OPENAI_INVOKING_KEY]: status.invoking, [OPENAI_INVOKED_KEY]: status.invoked }
    : {};
  return {
    ...config,
    title: config.annotations?.title,
    _meta: { ...statusMeta, ...config._meta },
  };
};

function widgetResourceOptions(uiHost) {
  return { chatgptEgress: uiHost?.chatgptEgress === true };
}

function withWidgetLocale(config, handler, language) {
  const resourceUri = config._meta?.[UI_META_KEY]?.resourceUri;
  if (!resourceUri) return handler;
  return async (...args) => {
    const result = await handler(...args);
    if (result?.isError) return result;
    return { ...result, _meta: { ...result?._meta, [WIDGET_LOCALE_META_KEY]: language } };
  };
}

const CONFIRMATION_CODE_META_KEY = "hermes/confirmation_code";
const CONFIRMATION_EXPIRES_META_KEY = "hermes/confirmation_expires_at";
const CALL_DATA_NOTICE_META_KEY = "hermes/call_data_notice";

function prepareCallCardMeta(confirmation, dataNotice) {
  return {
    [CONFIRMATION_CODE_META_KEY]: confirmation.code,
    [CONFIRMATION_EXPIRES_META_KEY]: confirmation.expires_at,
    [CALL_DATA_NOTICE_META_KEY]: dataNotice,
  };
}
const CONFIRMATION_USED_STATUS = "confirmation_used";

function confirmationUsedResult(loc) {
  return { ...errText(loc.mcp.confirmationAlreadyUsed), structuredContent: { status: CONFIRMATION_USED_STATUS } };
}

function unconfirmedResult(loc, confirmResult) {
  if (confirmResult.reason === CONFIRMATION_ALREADY_USED_REASON) return confirmationUsedResult(loc);
  return errText(loc.mcp.confirmationRequired(confirmResult.preview.to, confirmResult.preview.objective));
}

export const PLACE_CALL_REQUEST_SCHEMA = {
  to: z
    .string()
    .describe(
      "Take the destination number over EXACTLY as the user gave it - copy the digits character by character, NEVER convert them or reshape them into E.164 (reshaping introduces digit errors; the server normalises deterministically). A national notation with a leading 0 is resolved by the server via the user's home country; international destinations need +XX/00XX - if a number looks like a foreign national format, ask the user for the international notation instead of guessing. Checked server-side by the safety gates (permission profile/allowlist, denylist, country).",
    ),
  objective: z
    .string()
    .describe(
      "The goal of the call as ONE speakable first-person sentence from the perspective of the calling assistant - it is read out VERBATIM to the called party right after the disclosure, BEFORE they answer. Phrase it the way a human states their concern on the phone, e.g. 'I would like to book a men's haircut for Max on Saturday morning.' NO bare-infinitive stub like 'Book an appointment'. ALWAYS name a concrete topic/occasion when it is known; if the topic itself is still unknown, ask the user FIRST, instead of sending off a vague task - a single missing detail is not a reason to ask, it belongs in the briefing or stays open. Background and details do NOT belong here, they belong in the briefing.",
    ),
  briefing: z
    .string()
    .optional()
    .describe(
      "Only the context this call needs: what it is about, the names involved, relevant preferences and history, the desired outcome and tone. SUMMARISE instead of copying in raw. NO secrets, passwords or payment data. Sensitive details only as needed. Write only what you KNOW: never script an answer for a detail you are missing. For each gap, decide: could you answer it yourself during the call from your own tools and context? Then leave the gap open and declare that in one line. Can only the principal know it? Then write the honest line that they will get back on it. Can anyone look it up? Then write nothing. The agent speaks as the principal's personal AI assistant, not as you; phrase the context from their perspective.",
    ),
  constraints: z
    .string()
    .optional()
    .describe(
      "Hard limits the agent must not cross in the conversation, e.g. 'Not before 10 am, at most 40 euros, do not promise a deposit.'",
    ),
  mandate: z
    .object({
      decide_freely: z
        .string()
        .optional()
        .describe(
          "The authorisation - what the agent may commit to in the call WITHOUT asking back, e.g. 'appointment on any weekday between 9 and 12, up to 60 euros'. Phrase it concretely enough that a yes/no decision can be derived from it on the phone; vague frames ('flexible', 'sometime') do not help. Never invent one: take the frame from what the user has already said, otherwise leave the field out. WITHOUT this field the agent may commit to nothing and only passes every proposal on as a message. Hard prohibitions do NOT belong here, they belong in constraints.",
        ),
      fallback_order: z
        .string()
        .optional()
        .describe(
          "Preference order the agent works through on its own if the first choice does not work, e.g. 'Thursday morning first, otherwise Friday, otherwise next week'. Without this field it will not try any alternative on its own.",
        ),
      on_out_of_scope: z
        .enum(MANDATE_OUT_OF_SCOPE_VALUES)
        .optional()
        .describe(
          "What the agent does when an offer lies OUTSIDE decide_freely: 'take_message' (default) - record the offer with all details, pass it on and promise that the user will get back; 'decline' - politely refuse, without a counter-offer; 'accept_best' - accept and record the best offer made anyway. Set 'accept_best' ONLY when the user explicitly says that any option suits them. Not applied on every call path.",
        ),
    })
    .optional()
    .describe(
      "Optional advance MANDATE: the frame within which the agent may decide ITSELF in the conversation, instead of returning every question as a message. Through this the agent books NOTHING and gets NO calendar access - it only commits verbally to what the user allowed in advance. Ask the user about their frame when an appointment or price question is to be expected in the call; without a mandate the agent can only answer 'When suits you?' with 'I will pass that on'. In a conflict with constraints, constraints ALWAYS win.",
    ),
  context: z
    .object({
      summary: z
        .string()
        .optional()
        .describe(
          "Only so the agent can state why it calls: 1-3 sentences, not a copy of the chat.",
        ),
      key_facts: z
        .array(z.string())
        .optional()
        .describe(
          "Only facts the agent must state correctly, e.g. names, dates; max. 10 short items. NO secrets/passwords/payment data.",
        ),
      recipient_relationship: z
        .string()
        .optional()
        .describe("Only if it sets the tone: how the principal knows the called party, e.g. 'regular hairdresser'."),
      desired_outcome: z
        .string()
        .optional()
        .describe("Only so the agent knows when it is done: the result the principal wants, briefly."),
      open_questions: OPEN_QUESTIONS_FIELD,
    })
    .optional()
    .describe(
      "Optional structured BACKGROUND, only for what the briefing lacks: fill a subfield only when this call needs it. The agent speaks as the principal's personal AI assistant, NEVER as you. NO secrets; sensitive details only as needed.",
    ),
  language: z
    .string()
    .optional()
    .describe(
      `The language the agent SPEAKS in this call - one of: ${SUPPORTED_LANGUAGES.join(", ")}. ` +
        "Leave it out unless the user asked for a particular language: without it the call " +
        "is held in the principal's own language. An unsupported code is REJECTED with an " +
        "error instead of being ignored. This does NOT change the language of the mandatory " +
        "AI disclosure - that always follows the person being called.",
    ),
  max_duration_s: z
    .number()
    .int()
    .positive()
    .max(MAX_CALL_DURATION_CAP_S)
    .optional()
    .describe(
      "Optional upper bound for the call duration in seconds. The server derives the " +
        "effective limit from the remaining credit and only ever applies a SHORTER value " +
        "than that; it never extends a call.",
    ),
  diagnostic: z
    .boolean()
    .optional()
    .describe(
      "Leave this unset in normal use. The server keeps the raw transcript of a call to the user's OWN verified number for a limited period on its own, so the conversation can be analysed afterwards - you do NOT have to ask for it. Set it to false ONLY when the user explicitly does not want that transcript kept. For any other destination the field has no effect.",
    ),
};

export function registerTools(
  server,
  {
    identity = null,
    scopedTenant = null,
    consultAllowed = false,
    uiHost = null,
    language = null,
  } = {},
) {
  const call = (method, path, body) => boundedHop({ method, path, body, identity, scopedTenant });
  const pollConsult = async (path) => {
    try {
      return await api({
        method: "GET",
        path,
        identity,
        scopedTenant,
        timeoutMs: CONSULT_POLL_ABORT_MS,
      });
    } catch (err) {
      if (isAbortError(err)) return NO_CONSULT_EVENT;
      throw err;
    }
  };
  const placeCallHopCall = (body) => placeCallHop({ identity, scopedTenant, body });
  const loc = localeFor(language);
  const formatDate = makeDateFormatter(loc.dateLocale);
  const uiRenderer = uiRendererFor(uiHost);

  const enableWidgetUi = (widgetId) => {
    if (!uiRenderer || !uiRenderer.hasWidget(widgetId)) return {};
    uiRenderer.registerResource(server, widgetId, widgetResourceOptions(uiHost));
    return { _meta: uiRenderer.toolMeta(widgetId) };
  };

  const wrapHandler =
    (handler) =>
    async (...args) => {
      try {
        return await handler(...args);
      } catch (err) {
        return errText(toolErrorText(err, loc.mcp));
      }
    };

  const uiTool = (name, config, handler) =>
    server.registerTool(
      name,
      withOpenAiToolMetadata(name, config),
      wrapHandler(withWidgetLocale(config, handler, loc.language)),
    );

  const callWidgetUi = enableWidgetUi(WIDGET_CALL);

  uiTool(
    "prepare_call",
    {
      description: PREPARE_CALL_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.prepare_call,
      inputSchema: PLACE_CALL_REQUEST_SCHEMA,
      outputSchema: PREPARE_CALL_OUTPUT,
      ...callWidgetUi,
    },
    async (args) => {
      const previewResult = await confirmCallHop({ identity, scopedTenant, body: args });
      requireFields(previewResult, { preview: "object" });
      const mcpUiEnabled = Boolean(callWidgetUi._meta);
      const meta =
        mcpUiEnabled && previewResult.confirmation
          ? prepareCallCardMeta(previewResult.confirmation, loc.mcp.callDataNotice)
          : undefined;
      return {
        content: [
          { type: "text", text: mcpUiEnabled ? loc.mcp.prepareCallCardHint : loc.mcp.prepareCallNoCardHint },
        ],
        structuredContent: previewResult.preview,
        ...(meta ? { _meta: meta } : {}),
      };
    },
  );

  uiTool(
    "place_call",
    {
      description: placeCallDescription(consultAllowed),
      annotations: TOOL_ANNOTATIONS.place_call,
      inputSchema: {
        ...PLACE_CALL_REQUEST_SCHEMA,
        confirmation_code: z
          .string()
          .optional()
          .describe(
            "Only the Hermes card can supply this, once the user confirms prepare_call (SAME arguments incl. briefing/context) - never guess or invent it. REQUIRED - without it the call is NOT placed.",
          ),
      },
      outputSchema: CALL_OUTPUT,
      ...callWidgetUi,
    },
    async (args) => {
      const { confirmation_code, ...request } = args;
      const confirmResult = await confirmCallHop({
        identity,
        scopedTenant,
        body: { ...request, confirmation_code },
      });
      requireFields(confirmResult, { preview: "object" });
      if (!confirmResult.confirmed) {
        return unconfirmedResult(loc, confirmResult);
      }
      const r = await placeCallHopCall(request);
      requireFields(r, { callId: "string" });
      const data = {
        call_id: r.callId,
        status: "dialing",
        duration_s: 0,
        last_transcript_lines: [],
        failure_reason: null,
        result_summary: null,
        objective_achieved: null,
        context_received: normalizeContextReceived(r.context_received),
        deduplicated: !!r.deduplicated,
      };
      const started = JSON.stringify({ call_id: data.call_id, status: data.status }, null, 2);
      const hinweise = [
        data.deduplicated ? loc.mcp.callAlreadyRunningHint : null,
        consultAllowed ? loc.mcp.consultPermissionHint : null,
      ].filter(Boolean);
      return {
        content: [{ type: "text", text: [started, ...hinweise].join("\n") }],
        structuredContent: data,
      };
    },
  );

  if (consultAllowed) {
    uiTool(
      "await_call_event",
      {
        description: AWAIT_CALL_EVENT_DESCRIPTION,
        annotations: TOOL_ANNOTATIONS.await_call_event,
        inputSchema: {
          call_id: z.string().describe("The call_id from place_call"),
          after_event_id: z
            .string()
            .optional()
            .describe(
              "The event_id you last handled. Pass it so you do not receive the same question twice.",
            ),
        },
        outputSchema: AWAIT_EVENT_OUTPUT,
      },
      async ({ call_id, after_event_id }) => {
        const query = after_event_id ? `?after=${encodeURIComponent(after_event_id)}` : "";
        const event = await pollConsult(`/api/calls/${call_id}/consult${query}`);
        const finished =
          event.event === CONSULT_EVENT.DONE ? await call("GET", `/api/calls/${call_id}`) : null;
        const data = awaitEventView({ callId: call_id, event, finished, texts: loc.mcp });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        };
      },
    );

    uiTool(
      "answer_consult",
      {
        description: ANSWER_CONSULT_DESCRIPTION,
        annotations: TOOL_ANNOTATIONS.answer_consult,
        inputSchema: {
          call_id: z.string().describe("The call_id from place_call"),
          event_id: z.string().describe("The event_id from await_call_event"),
          status: z
            .enum([CONSULT_ANSWER_MODE.WORKING, CONSULT_ANSWER_MODE.FINAL])
            .optional()
            .describe(
              '"working" = acknowledge immediately, no answers needed. "final" (default) = the answer.',
            ),
          answers: z
            .array(z.string())
            .optional()
            .describe(
              "One short answer per open question, in the order the questions were given. " +
                'Required unless status is "working".',
            ),
        },
        outputSchema: ANSWER_CONSULT_OUTPUT,
      },
      async ({ call_id, event_id, status, answers }) => {
        rejectRestrictedData({ answers }, []);
        try {
          const r = await call("POST", `/api/calls/${call_id}/consult/answer`, { event_id, status, answers });
          if (status === CONSULT_ANSWER_MODE.WORKING) {
            return {
              content: [{ type: "text", text: loc.mcp.consultAckAccepted }],
              structuredContent: { accepted: true, merged_facts: 0 },
            };
          }
          const mergedFacts = typeof r?.merged_facts === "number" ? r.merged_facts : 0;
          return {
            content: [{ type: "text", text: loc.mcp.consultAnswerAccepted(mergedFacts) }],
            structuredContent: { accepted: true, merged_facts: mergedFacts },
          };
        } catch (err) {
          if (err?.httpStatus === CONSULT_ANSWER_REJECTED_STATUS)
            return notAccepted(loc.mcp.consultAnswerRejected);
          if (err?.httpStatus === CONSULT_ANSWER_CONFLICT_STATUS)
            return notAccepted(loc.mcp.consultNoLongerOpen);
          throw err;
        }
      },
    );
  }

  const callStatusResult = async (call_id) => {
    const c = await call("GET", `/api/calls/${call_id}`);
    requireFields(c, { transcript: "array" });
    const data = pickCallStatus(call_id, c, loc.mcp);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: data.status,
              duration_s: data.duration_s,
              last_transcript_lines: data.last_transcript_lines,
            },
            null,
            2,
          ),
        },
      ],
      structuredContent: data,
    };
  };

  uiTool(
    "get_call_status",
    {
      description:
        "Returns the live state of a call: status (dialing|in_progress|completed|failed|cancelled), duration and the last transcript lines. Some clients also show a live card that updates itself; call this tool regardless whenever the current state is needed, it always reflects it.",
      annotations: TOOL_ANNOTATIONS.get_call_status,
      inputSchema: { call_id: z.string().describe("The call_id from place_call") },
      outputSchema: CALL_STATUS_OUTPUT,
    },
    async ({ call_id }) => callStatusResult(call_id),
  );

  uiTool(
    "get_call_result",
    {
      description: CALL_RESULT_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_call_result,
      inputSchema: { call_id: z.string().describe("The call_id from place_call") },
      outputSchema: CALL_RESULT_OUTPUT,
    },
    async ({ call_id }) => {
      const c = await call("GET", `/api/calls/${call_id}`);
      if (c.status === "active") return errText(loc.mcp.callStillRunning);
      requireFields(c, { transcript: "array" });
      const data = pickTranscript(call_id, c, loc.mcp);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                result_summary: data.result_summary,
                objective_achieved: data.objective_achieved,
                outcome: data.outcome,
                commitments: data.commitments,
                counterparty_commitments: data.counterparty_commitments,
                open_points: data.open_points,
                next_step: data.next_step,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: data,
      };
    },
  );

  uiTool(
    "cancel_call",
    {
      description: CANCEL_CALL_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.cancel_call,
      inputSchema: { call_id: z.string().describe("The call_id from place_call") },
    },
    async ({ call_id }) => text(await call("POST", `/api/calls/${call_id}/cancel`)),
  );

  uiTool(
    "get_agent_number",
    {
      description: "Returns the phone number of the phone agent.",
      annotations: TOOL_ANNOTATIONS.get_agent_number,
      inputSchema: {},
      outputSchema: MY_NUMBER_OUTPUT,
      ...enableWidgetUi(WIDGET_MY_NUMBER),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object" });
      const data = pickMyNumber(s);
      return {
        content: [
          { type: "text", text: JSON.stringify({ number: s.agent.number }, null, 2) },
        ],
        structuredContent: data,
      };
    },
  );

  uiTool(
    "list_calls",
    {
      description:
        "Lists the agent's most recent calls (inbound and outbound) with status and summary.",
      annotations: TOOL_ANNOTATIONS.list_calls,
      inputSchema: {},
      outputSchema: CALLS_OUTPUT,
      ...enableWidgetUi(WIDGET_CALLS),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { calls: "array" });
      const entries = s.calls.map((c) => pickCall(c, formatDate));
      const txt = entries.length ? entries.map(callTextLine).join("\n") : loc.mcp.emptyCalls;
      return {
        content: [{ type: "text", text: txt }],
        structuredContent: { calls: entries },
      };
    },
  );

  uiTool(
    "check_inbox",
    {
      description: CHECK_INBOX_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.check_inbox,
      inputSchema: { include_seen: INCLUDE_SEEN_FIELD },
      outputSchema: INBOX_OUTPUT,
    },
    async ({ include_seen: includeSeen = false } = {}) => {
      const polled = await call("POST", "/api/inbox/poll", { include_seen: includeSeen });
      requireFields(polled, { entries: "array", remaining: "number" });
      const entries = polled.entries.map((entry) => inboxEntryForModel(entry, formatDate));
      const txt = entries.length
        ? entries.map((entry) => inboxTextLine(entry, loc.mcp)).join("\n")
        : loc.mcp.emptyInbox;
      return {
        content: [{ type: "text", text: txt }],
        structuredContent: { entries, remaining: polled.remaining },
      };
    },
  );

  uiTool(
    "list_action_items",
    {
      description: "Lists open action items from all calls.",
      annotations: TOOL_ANNOTATIONS.list_action_items,
      inputSchema: {},
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { actionItems: "array" });
      const open = s.actionItems.filter((item) => !item.done);
      return open.length ? text(actionItemsText(open, loc.mcp)) : text(loc.mcp.emptyActionItems);
    },
  );

  function planUsageLine(percent, agentStatusTexts) {
    return percent === null ? agentStatusTexts.planUsageUnknown : agentStatusTexts.planUsage(percent);
  }

  uiTool(
    "get_agent_status",
    {
      description: AGENT_STATUS_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_agent_status,
      inputSchema: {},
      outputSchema: AGENT_STATUS_OUTPUT,
      ...enableWidgetUi(WIDGET_AGENT_STATUS),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object", usage: "object", settings: "object" });
      const data = pickAgentStatus(s, loc.mcp);
      const A = loc.mcp.agentStatus;
      return {
        content: [
          {
            type: "text",
            text:
              `${A.number}: ${data.number}\n${A.owner}: ${data.owner}\n` +
              `${A.calls}: ${data.calls}\n` +
              `${planUsageLine(data.planUsagePercent, A)}\n` +
              `${A.permissions}: ${data.permissions}`,
          },
        ],
        structuredContent: data,
      };
    },
  );
}
