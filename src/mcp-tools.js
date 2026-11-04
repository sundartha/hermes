import {
  MAX_CALL_DURATION_CAP_S,
  MANDATE_OUT_OF_SCOPE_VALUES,
  KEY_FACTS_LIMITS,
  CONSULT_ANSWER_MODE,
} from "./store/defaults.js";
import { CONSULT_EVENT } from "./consult/delivery.js";
import "./call-result.js";
import { maskRestrictedText } from "./restricted-data.js";
import "./telephony/failure-reason.js";
import { toolErrorText } from "./mcp/fehler.js";
import { text, jsonText, notAccepted } from "./mcp/ausgabe.js";
import { rejectRestrictedData } from "./mcp/eingabe.js";
import { PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS, requireFields } from "./mcp/gateway.js";
import {
  AWAIT_EVENT_OUTPUT,
  ANSWER_CONSULT_OUTPUT,
  INBOX_OUTPUT,
  INCLUDE_SEEN_FIELD,
  awaitCallEventInputSchema,
  answerConsultInputSchema,
} from "./mcp/schemata.js";
import {
  CHECK_INBOX_DESCRIPTION,
  AWAIT_CALL_EVENT_DESCRIPTION,
  answerConsultDescription,
  LIST_ACTION_ITEMS_DESCRIPTION,
} from "./mcp/beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./mcp/metadaten.js";
import { createToolContext } from "./mcp/kontext.js";
import { registerPrepareCall, registerPlaceCall, registerCancelCall } from "./mcp/anruf-starten.js";
import { registerGetAgentNumber, registerGetAgentStatus } from "./mcp/status.js";
import {
  callOutcomeView,
  pickTranscript,
  maskResultCardFields,
  maskedResultCard,
} from "./mcp/anruf-ergebnis.js";
import {
  registerGetCallStatus,
  registerGetCallResult,
  registerListCalls,
} from "./mcp/anruf-lesen.js";

export { toolErrorText, PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS };
export { pickTranscript } from "./mcp/anruf-ergebnis.js";

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
        content: [{ type: "text", text: jsonText(data) }],
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
