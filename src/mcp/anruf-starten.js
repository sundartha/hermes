import { CONFIRMATION_ALREADY_USED_REASON } from "../call-confirmation.js";
import { text, errText, jsonText } from "./ausgabe.js";
import { confirmCallHop, requireFields } from "./gateway.js";
import {
  CALL_OUTPUT,
  PREPARE_CALL_OUTPUT,
  placeCallRequestSchema,
  placeCallInputSchema,
  callIdInputSchema,
} from "./schemata.js";
import {
  PREPARE_CALL_DESCRIPTION,
  placeCallDescription,
  CANCEL_CALL_DESCRIPTION,
} from "./beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./metadaten.js";

function normalizeContextReceived(cr) {
  return {
    active: !!cr?.active,
    summary: !!cr?.summary,
    key_facts_count: typeof cr?.key_facts_count === "number" ? cr.key_facts_count : 0,
    recipient_relationship: !!cr?.recipient_relationship,
    desired_outcome: !!cr?.desired_outcome,
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
  return {
    ...errText(loc.mcp.confirmationAlreadyUsed),
    structuredContent: { status: CONFIRMATION_USED_STATUS },
  };
}

function unconfirmedResult(loc, confirmResult) {
  if (confirmResult.reason === CONFIRMATION_ALREADY_USED_REASON) return confirmationUsedResult(loc);
  return errText(
    loc.mcp.confirmationRequired(confirmResult.preview.to, confirmResult.preview.objective),
  );
}

export function registerPrepareCall({
  identity,
  scopedTenant,
  loc,
  uiTool,
  callWidgetUi,
  begriffe,
}) {
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
          {
            type: "text",
            text: mcpUiEnabled ? loc.mcp.prepareCallCardHint : loc.mcp.prepareCallNoCardHint,
          },
        ],
        structuredContent: previewResult.preview,
        ...(meta ? { _meta: meta } : {}),
      };
    },
  );
}

export function registerPlaceCall({
  identity,
  scopedTenant,
  consultAllowed,
  placeCallHopCall,
  loc,
  uiTool,
  callWidgetUi,
  begriffe,
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

export function registerCancelCall({ call, uiTool }) {
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
