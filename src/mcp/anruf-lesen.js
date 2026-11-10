import { WIDGET_CONTENT_LOCALE_META_KEY } from "../ui/widget-i18n.js";
import { WIDGET_CALLS } from "../ui/widget-catalog.js";
import { localeFor } from "../i18n/locales.js";
import { maskRestrictedText } from "../restricted-data.js";
import { jsonText, errText } from "./ausgabe.js";
import { requireFields } from "./gateway.js";
import {
  CALL_STATUS_OUTPUT,
  CALL_RESULT_OUTPUT,
  CALLS_OUTPUT,
  callIdInputSchema,
} from "./schemata.js";
import {
  CALL_RESULT_DESCRIPTION,
  GET_CALL_STATUS_DESCRIPTION,
  LIST_CALLS_DESCRIPTION,
} from "./beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./metadaten.js";
import { MS_PER_SECOND } from "../utils/timer.js";
import { mapStatus, callOutcomeView, pickTranscript } from "./anruf-ergebnis.js";

const LAST_TRANSCRIPT_LINES = 6;

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

export function callTimestamps(callRecord) {
  return {
    server_time: new Date().toISOString(),
    started_at: validTimestamp(callRecord.startedAt),
    answered_at: validTimestamp(callRecord.answeredAt),
  };
}

function durationS(callRecord) {
  const answeredAt = validTimestamp(callRecord.answeredAt);
  if (!answeredAt) return 0;
  const end = callRecord.endedAt ? validTimestamp(callRecord.endedAt) : new Date().toISOString();
  if (!end) return 0;
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(answeredAt)) / MS_PER_SECOND));
}

function pickCallStatus(callId, call, texts) {
  return {
    call_id: callId,
    ...callOutcomeView(call),
    ...callTimestamps(call),
    duration_s: durationS(call),
    last_transcript_lines: call.transcript
      .slice(-LAST_TRANSCRIPT_LINES)
      .map((transcriptLine) =>
        maskRestrictedText(
          `${transcriptLine.role === "agent" ? texts.roleAgent : texts.roleCounterparty}: ${transcriptLine.text}`,
        ),
      ),
  };
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

function summaryLanguageOf(callRecord, tenantLanguage) {
  if (callRecord.result) return localeFor(callRecord.language).language;
  return callRecord.summary ? null : tenantLanguage;
}

function callResultReply(callId, callRecord, loc) {
  const data = pickTranscript(callId, callRecord, loc.mcp);
  const text = jsonText({
    result_summary: data.result_summary,
    objective_achieved: data.objective_achieved,
    outcome: data.outcome,
    commitments: data.commitments,
    counterparty_commitments: data.counterparty_commitments,
    open_points: data.open_points,
    next_step: data.next_step,
  });
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
  const languages = new Set(
    calls.map((callRecord) => summaryLanguageOf(callRecord, tenantLanguage)),
  );
  const language =
    languages.size === 0 ? tenantLanguage : languages.size === 1 ? [...languages][0] : null;
  return { [WIDGET_CONTENT_LOCALE_META_KEY]: language };
}

async function callStatusResult({ call, loc }, callId) {
  const callRecord = await call("GET", `/api/calls/${callId}`);
  requireFields(callRecord, { transcript: "array" });
  const data = pickCallStatus(callId, callRecord, loc.mcp);
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

export function registerGetCallStatus(ctx) {
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

export function registerGetCallResult({ call, loc, uiTool }) {
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

export function registerListCalls({ call, loc, formatDate, enableWidgetUi, uiTool }) {
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
