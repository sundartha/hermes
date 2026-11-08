import { text, jsonText } from "./ausgabe.js";
import { requireFields } from "./gateway.js";
import {
  CALL_OUTPUT,
  placeCallRequestSchema,
  callIdInputSchema,
} from "./schemata.js";
import {
  placeCallDescription,
  CANCEL_CALL_DESCRIPTION,
} from "./beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./metadaten.js";
import { callTimestamps } from "./anruf-lesen.js";

function normalizeContextReceived(cr) {
  return {
    active: !!cr?.active,
    summary: !!cr?.summary,
    key_facts_count: typeof cr?.key_facts_count === "number" ? cr.key_facts_count : 0,
    recipient_relationship: !!cr?.recipient_relationship,
    desired_outcome: !!cr?.desired_outcome,
  };
}

export function registerPlaceCall({
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
      inputSchema: placeCallRequestSchema(begriffe),
      outputSchema: CALL_OUTPUT,
      ...callWidgetUi,
    },
    async (args) => {
      const placed = await placeCallHopCall(args);
      requireFields(placed, { callId: "string" });
      const data = {
        call_id: placed.callId,
        status: "dialing",
        ...callTimestamps({ startedAt: placed.startedAt }),
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
