import { CONSULT_EVENT } from "../consult/delivery.js";
import { maskRestrictedText } from "../restricted-data.js";
import { jsonText, notAccepted } from "./ausgabe.js";
import { rejectRestrictedData } from "./eingabe.js";
import {
  AWAIT_EVENT_OUTPUT,
  ANSWER_CONSULT_OUTPUT,
  awaitCallEventInputSchema,
  answerConsultInputSchema,
} from "./schemata.js";
import { AWAIT_CALL_EVENT_DESCRIPTION, answerConsultDescription } from "./beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./metadaten.js";
import { callOutcomeView, pickTranscript, maskedResultCard } from "./anruf-ergebnis.js";

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

export function registerAwaitCallEvent({ call, pollConsult, loc, uiTool }) {
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

export function registerAnswerConsult({ call, loc, uiTool, begriffe }) {
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
