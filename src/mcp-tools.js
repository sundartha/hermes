import { WIDGET_CONTENT_LOCALE_META_KEY } from "./ui/widget-i18n.js";
import { WIDGET_AGENT_STATUS } from "./ui/adapters/mcp-native.js";
import { WIDGET_MY_NUMBER, WIDGET_CALLS } from "./ui/widget-catalog.js";
import {
  MAX_CALL_DURATION_CAP_S,
  MANDATE_OUT_OF_SCOPE_VALUES,
  KEY_FACTS_LIMITS,
  CONSULT_ANSWER_MODE,
} from "./store/defaults.js";
import { CONSULT_EVENT } from "./consult/delivery.js";
import { resultCardView } from "./call-result.js";
import { localeFor } from "./i18n/locales.js";
import { maskRestrictedText } from "./restricted-data.js";
import { failureReasonBase } from "./telephony/failure-reason.js";
import { toolErrorText } from "./mcp/fehler.js";
import { text, errText, notAccepted } from "./mcp/ausgabe.js";
import { rejectRestrictedData } from "./mcp/eingabe.js";
import { PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS, requireFields } from "./mcp/gateway.js";
import {
  CALL_STATUS_OUTPUT,
  CALL_RESULT_OUTPUT,
  AWAIT_EVENT_OUTPUT,
  ANSWER_CONSULT_OUTPUT,
  AGENT_STATUS_OUTPUT,
  MY_NUMBER_OUTPUT,
  CALLS_OUTPUT,
  INBOX_OUTPUT,
  INCLUDE_SEEN_FIELD,
  callIdInputSchema,
  awaitCallEventInputSchema,
  answerConsultInputSchema,
} from "./mcp/schemata.js";
import {
  CHECK_INBOX_DESCRIPTION,
  AWAIT_CALL_EVENT_DESCRIPTION,
  CALL_RESULT_DESCRIPTION,
  AGENT_STATUS_DESCRIPTION,
  answerConsultDescription,
  GET_CALL_STATUS_DESCRIPTION,
  GET_AGENT_NUMBER_DESCRIPTION,
  LIST_CALLS_DESCRIPTION,
  LIST_ACTION_ITEMS_DESCRIPTION,
} from "./mcp/beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./mcp/metadaten.js";
import { createToolContext } from "./mcp/kontext.js";
import { registerPrepareCall, registerPlaceCall, registerCancelCall } from "./mcp/anruf-starten.js";

export { toolErrorText, PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS };

const LAST_TRANSCRIPT_LINES = 6;

function mapStatus(call) {
  if (call.status === "active") return call.answeredAt ? "in_progress" : "dialing";
  return call.status;
}
function durationS(c) {
  const start = c.startedAt;
  const end = c.endedAt || new Date().toISOString();
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}

function callOutcomeView(call) {
  return { status: mapStatus(call), failure_reason: failureReasonBase(call.failureReason) };
}

function pickCallStatus(callId, call, texts) {
  return {
    call_id: callId,
    ...callOutcomeView(call),
    duration_s: durationS(call),
    last_transcript_lines: call.transcript
      .slice(-LAST_TRANSCRIPT_LINES)
      .map((transcriptLine) => maskRestrictedText(`${transcriptLine.role === "agent" ? texts.roleAgent : texts.roleCounterparty}: ${transcriptLine.text}`)),
  };
}

const AWAIT_SUMMARY_PLACEHOLDER = localeFor("de").mcp.awaitSummary;

export function pickTranscript(callId, call, texts = null) {
  const failureSummary =
    texts && mapStatus(call) === "failed" ? texts.callFailedSummary(call.failureReason) : null;
  return {
    call_id: callId,
    result_summary: maskRestrictedText(call.summary || failureSummary || texts?.awaitSummary || AWAIT_SUMMARY_PLACEHOLDER),
    objective_achieved: call.objectiveAchieved ?? "unclear",
    ...maskedResultCard(call.result),
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

const CONSULT_ANSWER_REJECTED_STATUS = 400;
const CONSULT_ANSWER_CONFLICT_STATUS = 409;

function permissionsSummary(settings, labels) {
  return (
    `${labels.summaries}=${settings.allowSummaries}, ${labels.personalData}=${settings.allowPersonalData}, ` +
    `${labels.bankData}=${settings.allowBankData}`
  );
}

function pickAgentStatus(state, texts) {
  return {
    number: state.agent.number ?? null,
    owner: state.agent.owner ?? null,
    calls: state.usage.calls,
    planUsagePercent: state.usage.planUsagePercent ?? null,
    permissions: permissionsSummary(state.settings, texts.permissionLabels),
  };
}

function pickMyNumber(state) {
  return { number: state.agent.number ?? null };
}

function pickCall(call, formatDate) {
  const entry = {
    id: call.id,
    direction: call.direction,
    counterparty: (call.direction === "outbound" ? call.to : call.from) ?? null,
    status: mapStatus(call),
    startedAt: formatDate(call.startedAt),
  };
  if (call.summary) entry.summary = maskRestrictedText(call.summary);
  return entry;
}

function callTextLine(entry) {
  const arrow = entry.direction === "outbound" ? "->" : "<-";
  return `[${entry.id}] ${arrow} ${entry.counterparty} | ${entry.status} | ${entry.startedAt}${entry.summary ? " | " + entry.summary : ""}`;
}

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

function summaryLanguageOf(callRecord, tenantLanguage) {
  if (callRecord.result) return localeFor(callRecord.language).language;
  return callRecord.summary ? null : tenantLanguage;
}

const JSON_INDENT_SPACES = 2;

function callResultReply(callId, callRecord, loc) {
  const data = pickTranscript(callId, callRecord, loc.mcp);
  const text = JSON.stringify(
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
    JSON_INDENT_SPACES,
  );
  return {
    content: [{ type: "text", text }],
    structuredContent: data,
    _meta: summaryContentMeta([callRecord], loc.language),
  };
}

function callsListReply(calls, loc, formatDate) {
  const entries = calls.map((callRecord) => pickCall(callRecord, formatDate));
  const text = entries.length ? entries.map(callTextLine).join("\n") : loc.mcp.emptyCalls;
  return {
    content: [{ type: "text", text }],
    structuredContent: { calls: entries },
    _meta: summaryContentMeta(calls, loc.language),
  };
}

function summaryContentMeta(calls, tenantLanguage) {
  const languages = new Set(calls.map((callRecord) => summaryLanguageOf(callRecord, tenantLanguage)));
  const language = languages.size === 0 ? tenantLanguage : languages.size === 1 ? [...languages][0] : null;
  return { [WIDGET_CONTENT_LOCALE_META_KEY]: language };
}

function registerAwaitCallEvent({ call, pollConsult, loc, uiTool }) {
  uiTool(
    "await_call_event",
    {
      description: AWAIT_CALL_EVENT_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.await_call_event,
      inputSchema: awaitCallEventInputSchema(),
      outputSchema: AWAIT_EVENT_OUTPUT,
    },
    async ({ call_id, after_event_id }) => {
      const query = after_event_id ? `?after=${encodeURIComponent(after_event_id)}` : "";
      const event = await pollConsult(`/api/calls/${call_id}/consult${query}`);
      const finished =
        event.event === CONSULT_EVENT.DONE ? await call("GET", `/api/calls/${call_id}`) : null;
      const data = awaitEventView({ callId: call_id, event, finished, texts: loc.mcp });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, JSON_INDENT_SPACES) }],
        structuredContent: data,
      };
    },
  );
}

function registerAnswerConsult({ call, loc, uiTool, begriffe }) {
  const answerMode = begriffe.CONSULT_ANSWER_MODE;
  uiTool(
    "answer_consult",
    {
      description: answerConsultDescription(begriffe.KEY_FACTS_LIMITS),
      annotations: TOOL_ANNOTATIONS.answer_consult,
      inputSchema: answerConsultInputSchema(begriffe),
      outputSchema: ANSWER_CONSULT_OUTPUT,
    },
    async ({ call_id, event_id, status, answers }) => {
      rejectRestrictedData({ answers }, []);
      try {
        const answerResponse = await call("POST", `/api/calls/${call_id}/consult/answer`, {
          event_id,
          status,
          answers,
        });
        if (status === answerMode.WORKING) {
          return {
            content: [{ type: "text", text: loc.mcp.consultAckAccepted }],
            structuredContent: { accepted: true, merged_facts: 0 },
          };
        }
        const mergedFacts =
          typeof answerResponse?.merged_facts === "number" ? answerResponse.merged_facts : 0;
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

async function callStatusResult({ call, loc }, callId) {
  const callRecord = await call("GET", `/api/calls/${callId}`);
  requireFields(callRecord, { transcript: "array" });
  const data = pickCallStatus(callId, callRecord, loc.mcp);
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
          JSON_INDENT_SPACES,
        ),
      },
    ],
    structuredContent: data,
  };
}

function registerGetCallStatus(ctx) {
  ctx.uiTool(
    "get_call_status",
    {
      description: GET_CALL_STATUS_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_call_status,
      inputSchema: callIdInputSchema(),
      outputSchema: CALL_STATUS_OUTPUT,
    },
    async ({ call_id }) => callStatusResult(ctx, call_id),
  );
}

function registerGetCallResult({ call, loc, uiTool }) {
  uiTool(
    "get_call_result",
    {
      description: CALL_RESULT_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_call_result,
      inputSchema: callIdInputSchema(),
      outputSchema: CALL_RESULT_OUTPUT,
    },
    async ({ call_id }) => {
      const callRecord = await call("GET", `/api/calls/${call_id}`);
      if (callRecord.status === "active") return errText(loc.mcp.callStillRunning);
      requireFields(callRecord, { transcript: "array" });
      return callResultReply(call_id, callRecord, loc);
    },
  );
}

function registerGetAgentNumber({ call, enableWidgetUi, uiTool }) {
  uiTool(
    "get_agent_number",
    {
      description: GET_AGENT_NUMBER_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_agent_number,
      inputSchema: {},
      outputSchema: MY_NUMBER_OUTPUT,
      ...enableWidgetUi(WIDGET_MY_NUMBER),
    },
    async () => {
      const state = await call("GET", "/api/state");
      requireFields(state, { agent: "object" });
      const data = pickMyNumber(state);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ number: state.agent.number }, null, JSON_INDENT_SPACES),
          },
        ],
        structuredContent: data,
      };
    },
  );
}

function registerListCalls({ call, loc, formatDate, enableWidgetUi, uiTool }) {
  uiTool(
    "list_calls",
    {
      description: LIST_CALLS_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.list_calls,
      inputSchema: {},
      outputSchema: CALLS_OUTPUT,
      ...enableWidgetUi(WIDGET_CALLS),
    },
    async () => {
      const state = await call("GET", "/api/state");
      requireFields(state, { calls: "array" });
      return callsListReply(state.calls, loc, formatDate);
    },
  );
}

function registerCheckInbox({ call, loc, formatDate, uiTool }) {
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
}

function registerListActionItems({ call, loc, uiTool }) {
  uiTool(
    "list_action_items",
    {
      description: LIST_ACTION_ITEMS_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.list_action_items,
      inputSchema: {},
    },
    async () => {
      const state = await call("GET", "/api/state");
      requireFields(state, { actionItems: "array" });
      const open = state.actionItems.filter((item) => !item.done);
      return open.length ? text(actionItemsText(open, loc.mcp)) : text(loc.mcp.emptyActionItems);
    },
  );
}

function planUsageLine(percent, agentStatusTexts) {
  return percent === null ? agentStatusTexts.planUsageUnknown : agentStatusTexts.planUsage(percent);
}

function registerGetAgentStatus({ call, loc, enableWidgetUi, uiTool }) {
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
      const state = await call("GET", "/api/state");
      requireFields(state, { agent: "object", usage: "object", settings: "object" });
      const data = pickAgentStatus(state, loc.mcp);
      const agentStatusTexts = loc.mcp.agentStatus;
      return {
        content: [
          {
            type: "text",
            text:
              `${agentStatusTexts.number}: ${data.number}\n${agentStatusTexts.owner}: ${data.owner}\n` +
              `${agentStatusTexts.calls}: ${data.calls}\n` +
              `${planUsageLine(data.planUsagePercent, agentStatusTexts)}\n` +
              `${agentStatusTexts.permissions}: ${data.permissions}`,
          },
        ],
        structuredContent: data,
      };
    },
  );
}

export function registerTools(server, optionen = {}) {
  const begriffe = {
    MAX_CALL_DURATION_CAP_S,
    MANDATE_OUT_OF_SCOPE_VALUES,
    KEY_FACTS_LIMITS,
    CONSULT_ANSWER_MODE,
  };
  const ctx = createToolContext(server, optionen, begriffe);
  registerPrepareCall(ctx);
  registerPlaceCall(ctx);
  if (ctx.consultAllowed) {
    registerAwaitCallEvent(ctx);
    registerAnswerConsult(ctx);
  }
  registerGetCallStatus(ctx);
  registerGetCallResult(ctx);
  registerCancelCall(ctx);
  registerGetAgentNumber(ctx);
  registerListCalls(ctx);
  registerCheckInbox(ctx);
  registerListActionItems(ctx);
  registerGetAgentStatus(ctx);
}
