import { MAX_CALL_DURATION_CAP_S, MANDATE_OUT_OF_SCOPE_VALUES, KEY_FACTS_LIMITS } from "./begriffe/anrufe.js";
import { CONSULT_ANSWER_MODE } from "./begriffe/rueckfrage.js";
import "./call-result.ts";
import "./restricted-data.js";
import "./telephony/failure-reason.js";
import { toolErrorText } from "./mcp/fehler.js";
import { PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS } from "./mcp/gateway.js";
import { createToolContext } from "./mcp/kontext.js";
import { registerPlaceCall, registerCancelCall } from "./mcp/anruf-starten.js";
import { registerGetAgentNumber, registerGetAgentStatus } from "./mcp/status.js";
import {
  registerGetCallStatus,
  registerGetCallResult,
  registerListCalls,
} from "./mcp/anruf-lesen.js";
import { registerAwaitCallEvent, registerAnswerConsult } from "./mcp/rueckfrage.js";
import { registerCheckInbox, registerListActionItems } from "./mcp/posteingang.js";

export { toolErrorText, PLACE_CALL_HOP_TIMEOUT_MS, MCP_HOP_TIMEOUT_MS };
export { pickTranscript } from "./mcp/anruf-ergebnis.js";

export function registerTools(server, optionen = {}) {
  const begriffe = {
    MAX_CALL_DURATION_CAP_S,
    MANDATE_OUT_OF_SCOPE_VALUES,
    KEY_FACTS_LIMITS,
    CONSULT_ANSWER_MODE,
  };
  const ctx = createToolContext(server, optionen, begriffe);
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
