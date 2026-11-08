import { CALL_PURPOSE_SHORT_RULE } from "../mcp-server-info.js";

export const CHECK_INBOX_DESCRIPTION =
  "Check the call inbox: inbound calls that finished since the last check - who called, " +
  "what they wanted, what was promised, and what to do now. CONSUMING: entries returned " +
  "here are marked as seen and will NOT appear again. Do NOT use this to browse or re-read " +
  "call history - use list_calls for that.";

const PLACE_CALL_DESCRIPTION =
  "Starts a real phone call by the AI agent to a phone number, pursuing the given objective. The call starts as soon as this tool is called - there is no confirmation step, so only call it once the user has asked for this call, and it is NOT reversible once placed; billed per minute to the caller's account. Which destinations are allowed is decided by the server through its safety gates (permission profile/allowlist, denylist, country, limits). A live-updating card is NOT guaranteed on every host - ALWAYS track the call via the call_id this tool returns, using get_call_status until it reports a final status. " +
  CALL_PURPOSE_SHORT_RULE +
  " For contracts, loans, insurance, tenancy, employment or legal matters, let decide_freely cover appointment times only and do not set 'accept_best', so the agent agrees to no terms there.";

const PLACE_CALL_CONSULT_LOOP =
  'Right after this call returns, start calling await_call_event with the returned call_id and keep calling it until it returns event="done" - if the agent runs into a detail the briefing left open, its question reaches you only inside this loop, and it can ask at most once, so answer it straight away. Place the call with what you have: an open detail costs nothing, a guessed one cannot be taken back.';

export function placeCallDescription(consultLoop) {
  return [PLACE_CALL_DESCRIPTION, consultLoop ? PLACE_CALL_CONSULT_LOOP : null]
    .filter(Boolean)
    .join(" ");
}

export const CANCEL_CALL_DESCRIPTION =
  "Cancels the call record and stops billing right away. Whether the phone line itself actually drops is NOT guaranteed on every call path - when it is not, the response says so explicitly instead of claiming a clean hangup.";

export const AWAIT_CALL_EVENT_DESCRIPTION =
  "Waits briefly (up to ~20 seconds) for the next event of a running call and returns " +
  "either a question from the agent, the final result, or nothing. Call this REPEATEDLY " +
  'right after place_call and keep going until it returns event="done" - that final ' +
  "answer carries the complete result (summary and whether the objective was achieved), " +
  'so there is no need to call get_call_result separately. event="none" simply means ' +
  "nothing happened yet: call it again. This tool NEVER returns audio. Each call also " +
  "writes to the call record: it notes that you polled and marks a pending question as " +
  "delivered. Pass after_event_id so you do not receive the same question twice.";

export const CALL_RESULT_DESCRIPTION =
  "After the call has ended, returns call_id, result_summary, objective_achieved and the " +
  "result card: outcome, commitments, counterparty_commitments, open_points, next_step. " +
  "This tool NEVER returns the raw transcript - whether the server keeps it afterwards on " +
  "its own follows the diagnostic rule of place_call's diagnostic field and is independent " +
  "of this response. Call this once get_call_status reports a final status - completed, " +
  "failed or cancelled, not only completed - it carries the result summary for those too.";

export const AGENT_STATUS_DESCRIPTION =
  "Returns the status of the phone agent with these fields: number (the agent's phone " +
  "number, or null), owner (the account owner's name, or null), calls (number of calls so " +
  "far), planUsagePercent (share of the monthly minute quota used, in percent, or null if " +
  "no quota is set), permissions (what the agent may share: summaries, personal data, bank " +
  "data).";

export function answerConsultDescription(keyFactsLimits) {
  return (
    "Answers a question the phone agent asked during a running call. " +
    "FIRST, the moment you receive the question, call this tool once with " +
    'status="working" and no answers - that tells the agent someone is on it. ' +
    'THEN send the real answer with status="final" (the default). ' +
    "Give SHORT factual answers - one entry per question, each at most " +
    keyFactsLimits.maxLen +
    " characters; longer answers are REJECTED and the question stays open. Do NOT invent " +
    "facts: if you do not know, say so honestly here instead of guessing. Answers reach " +
    "the agent as background information. The agent may relay your answer to the person " +
    "on the call."
  );
}

export const GET_CALL_STATUS_DESCRIPTION =
  "Returns the live state of a call: status (dialing|in_progress|completed|failed|cancelled), duration and the last transcript lines. Some clients also show a live card that updates itself; call this tool regardless whenever the current state is needed, it always reflects it.";

export const GET_AGENT_NUMBER_DESCRIPTION = "Returns the phone number of the phone agent.";

export const LIST_CALLS_DESCRIPTION =
  "Lists the agent's most recent calls (inbound and outbound) with status and summary.";

export const LIST_ACTION_ITEMS_DESCRIPTION = "Lists open action items from all calls.";
