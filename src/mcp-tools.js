import {
  MAX_CALL_DURATION_CAP_S,
  MANDATE_OUT_OF_SCOPE_VALUES,
  KEY_FACTS_LIMITS,
  CONSULT_ANSWER_MODE,
} from "./store/defaults.js";
import "./call-result.js";
import { maskRestrictedText } from "./restricted-data.js";
import "./telephony/failure-reason.js";
import { toolErrorText } from "./mcp/fehler.js";
import { text } from "./mcp/ausgabe.js";
import { PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS, requireFields } from "./mcp/gateway.js";
import { INBOX_OUTPUT, INCLUDE_SEEN_FIELD } from "./mcp/schemata.js";
import { CHECK_INBOX_DESCRIPTION, LIST_ACTION_ITEMS_DESCRIPTION } from "./mcp/beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./mcp/metadaten.js";
import { createToolContext } from "./mcp/kontext.js";
import { registerPrepareCall, registerPlaceCall, registerCancelCall } from "./mcp/anruf-starten.js";
import { registerGetAgentNumber, registerGetAgentStatus } from "./mcp/status.js";
import { maskResultCardFields } from "./mcp/anruf-ergebnis.js";
import {
  registerGetCallStatus,
  registerGetCallResult,
  registerListCalls,
} from "./mcp/anruf-lesen.js";
import { registerAwaitCallEvent, registerAnswerConsult } from "./mcp/rueckfrage.js";

export { toolErrorText, PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS };
export { pickTranscript } from "./mcp/anruf-ergebnis.js";

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
