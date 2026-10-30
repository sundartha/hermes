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
import { CONSULT_EVENT } from "./consult/delivery.js";
import { resultCardView } from "./call-result.js";
import { localeFor } from "./i18n/locales.js";
import { toolErrorText } from "./mcp/fehler.js";
import { errText, jsonText, makeDateFormatter, notAccepted, text } from "./mcp/ausgabe.js";
import { rejectRestrictedData } from "./mcp/eingabe.js";
import {
  boundedHop,
  confirmCallHop,
  MCP_HOP_TIMEOUT_MS,
  placeCallHop,
  PLACE_CALL_HOP_TIMEOUT_MS,
  pollConsultHop,
  requireFields,
} from "./mcp/gateway.js";
import {
  AGENT_STATUS_OUTPUT,
  ANSWER_CONSULT_OUTPUT,
  answerConsultInputSchema,
  AWAIT_EVENT_OUTPUT,
  awaitCallEventInputSchema,
  CALL_OUTPUT,
  CALL_RESULT_OUTPUT,
  CALL_STATUS_OUTPUT,
  callIdInputSchema,
  CALLS_OUTPUT,
  INBOX_OUTPUT,
  INCLUDE_SEEN_FIELD,
  MY_NUMBER_OUTPUT,
  placeCallInputSchema,
  placeCallRequestSchema,
  PREPARE_CALL_OUTPUT,
} from "./mcp/schemata.js";
import { maskRestrictedText } from "./restricted-data.js";
import { failureReasonBase } from "./telephony/failure-reason.js";
import {
  AGENT_STATUS_DESCRIPTION,
  answerConsultDescription,
  AWAIT_CALL_EVENT_DESCRIPTION,
  CALL_RESULT_DESCRIPTION,
  CANCEL_CALL_DESCRIPTION,
  CHECK_INBOX_DESCRIPTION,
  GET_AGENT_NUMBER_DESCRIPTION,
  GET_CALL_STATUS_DESCRIPTION,
  LIST_ACTION_ITEMS_DESCRIPTION,
  LIST_CALLS_DESCRIPTION,
  placeCallDescription,
  PREPARE_CALL_DESCRIPTION,
} from "./mcp/beschreibungen.js";
import { CONFIRMATION_ALREADY_USED_REASON } from "./call-confirmation.js";

export { MCP_HOP_TIMEOUT_MS, PLACE_CALL_HOP_TIMEOUT_MS, toolErrorText };

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

const AWAIT_SUMMARY_PLACEHOLDER =
  "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";

export function pickTranscript(callId, call, texts = null) {
  const failureSummary =
    texts && mapStatus(call) === "failed" ? texts.callFailedSummary(call.failureReason) : null;
  return {
    call_id: callId,
    result_summary: maskRestrictedText(call.summary || failureSummary || AWAIT_SUMMARY_PLACEHOLDER),
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

function normalizeContextReceived(cr) {
  return {
    active: !!cr?.active,
    summary: !!cr?.summary,
    key_facts_count: typeof cr?.key_facts_count === "number" ? cr.key_facts_count : 0,
    recipient_relationship: !!cr?.recipient_relationship,
    desired_outcome: !!cr?.desired_outcome,
  };
}

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

function createToolContext(
  server,
  {
    identity = null,
    scopedTenant = null,
    consultAllowed = false,
    uiHost = null,
    language = null,
  } = {},
  begriffe,
) {
  const call = (method, path, body) => boundedHop({ method, path, body, identity, scopedTenant });
  const pollConsult = (path) => pollConsultHop({ identity, scopedTenant, path });
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

  return {
    identity,
    scopedTenant,
    consultAllowed,
    begriffe,
    call,
    pollConsult,
    placeCallHopCall,
    loc,
    formatDate,
    enableWidgetUi,
    uiTool,
    callWidgetUi,
  };
}

function registerPrepareCall({ identity, scopedTenant, begriffe, loc, uiTool, callWidgetUi }) {
  uiTool(
    "prepare_call",
    {
      description: PREPARE_CALL_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.prepare_call,
      inputSchema: placeCallRequestSchema(begriffe),
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
}

function registerPlaceCall({
  identity,
  scopedTenant,
  consultAllowed,
  begriffe,
  placeCallHopCall,
  loc,
  uiTool,
  callWidgetUi,
}) {
  uiTool(
    "place_call",
    {
      description: placeCallDescription(consultAllowed),
      annotations: TOOL_ANNOTATIONS.place_call,
      inputSchema: placeCallInputSchema(begriffe),
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
      const placed = await placeCallHopCall(request);
      requireFields(placed, { callId: "string" });
      const data = {
        call_id: placed.callId,
        status: "dialing",
        duration_s: 0,
        last_transcript_lines: [],
        failure_reason: null,
        result_summary: null,
        objective_achieved: null,
        context_received: normalizeContextReceived(placed.context_received),
        deduplicated: !!placed.deduplicated,
      };
      const started = jsonText({ call_id: data.call_id, status: data.status });
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

function registerAnswerConsult({ begriffe, call, loc, uiTool }) {
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
        const mergedFacts = typeof answerResponse?.merged_facts === "number" ? answerResponse.merged_facts : 0;
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

async function callStatusResult({ call, loc }, call_id) {
  const callRecord = await call("GET", `/api/calls/${call_id}`);
  requireFields(callRecord, { transcript: "array" });
  const data = pickCallStatus(call_id, callRecord, loc.mcp);
  return {
    content: [
      {
        type: "text",
        text: jsonText({
          status: data.status,
          duration_s: data.duration_s,
          last_transcript_lines: data.last_transcript_lines,
        }),
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
      const data = pickTranscript(call_id, callRecord, loc.mcp);
      return {
        content: [
          {
            type: "text",
            text: jsonText({
              result_summary: data.result_summary,
              objective_achieved: data.objective_achieved,
              outcome: data.outcome,
              commitments: data.commitments,
              counterparty_commitments: data.counterparty_commitments,
              open_points: data.open_points,
              next_step: data.next_step,
            }),
          },
        ],
        structuredContent: data,
      };
    },
  );
}

function registerCancelCall({ call, uiTool }) {
  uiTool(
    "cancel_call",
    {
      description: CANCEL_CALL_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.cancel_call,
      inputSchema: callIdInputSchema(),
    },
    async ({ call_id }) => text(await call("POST", `/api/calls/${call_id}/cancel`)),
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
        content: [{ type: "text", text: jsonText({ number: state.agent.number }) }],
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
      const entries = state.calls.map((callRecord) => pickCall(callRecord, formatDate));
      const txt = entries.length ? entries.map(callTextLine).join("\n") : loc.mcp.emptyCalls;
      return {
        content: [{ type: "text", text: txt }],
        structuredContent: { calls: entries },
      };
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
