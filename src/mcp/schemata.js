import { z } from "zod";
import { SUPPORTED_LANGUAGES } from "../i18n/locales.js";

export const CALL_STATUS_OUTPUT = {
  call_id: z.string(),
  status: z.string(),
  duration_s: z.number(),
  last_transcript_lines: z.array(z.string()),
  failure_reason: z.string().nullable(),
};

const RESULT_CARD_OUTPUT = {
  outcome: z.string().nullable(),
  commitments: z.array(z.string()),
  counterparty_commitments: z.array(z.string()),
  open_points: z.array(z.string()),
  next_step: z.string().nullable(),
};

export const CALL_RESULT_OUTPUT = {
  call_id: z.string(),
  result_summary: z.string(),
  objective_achieved: z.union([z.boolean(), z.string()]),
  ...RESULT_CARD_OUTPUT,
};

export const AWAIT_EVENT_OUTPUT = {
  event: z.string(),
  event_id: z.string().nullable(),
  questions: z.array(z.string()),
  status: z.string().nullable(),
  failure_reason: z.string().nullable(),
  result_summary: z.string().nullable(),
  objective_achieved: z.union([z.boolean(), z.string()]).nullable(),
  ...RESULT_CARD_OUTPUT,
};

export const ANSWER_CONSULT_OUTPUT = {
  accepted: z.boolean(),
  merged_facts: z.number(),
};

const CONTEXT_RECEIVED_OUTPUT = z.object({
  active: z.boolean(),
  summary: z.boolean(),
  key_facts_count: z.number(),
  recipient_relationship: z.boolean(),
  desired_outcome: z.boolean(),
});

export const CALL_OUTPUT = {
  ...CALL_STATUS_OUTPUT,
  result_summary: z.string().nullable(),
  objective_achieved: z.union([z.boolean(), z.string()]).nullable(),
  context_received: CONTEXT_RECEIVED_OUTPUT,
  deduplicated: z.boolean(),
};

export const PREPARE_CALL_OUTPUT = {
  status: z.string(),
  to: z.string(),
  objective: z.string(),
  language: z.string().optional(),
  max_duration_s: z.number().optional(),
  briefing: z.string().optional(),
  constraints: z.string().optional(),
  mandate: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  diagnostic: z.boolean().optional(),
};

export const AGENT_STATUS_OUTPUT = {
  number: z.string().nullable(),
  owner: z.string().nullable(),
  calls: z.number(),
  planUsagePercent: z.number().nullable(),
  permissions: z.string(),
};

export const MY_NUMBER_OUTPUT = { number: z.string().nullable() };

const CALL_LIST_ENTRY = z.object({
  id: z.string(),
  direction: z.string(),
  counterparty: z.string().nullable(),
  status: z.string(),
  startedAt: z.string(),
  summary: z.string().optional(),
});
export const CALLS_OUTPUT = { calls: z.array(CALL_LIST_ENTRY) };

const INBOX_ENTRY = z.object({
  call_id: z.string(),
  caller: z.string().nullable(),
  at: z.string().nullable(),
  summary: z.string().nullable(),
  summary_unavailable: z.boolean(),
  ...RESULT_CARD_OUTPUT,
  action_items: z.array(z.string()),
  action_required: z.boolean(),
});
export const INBOX_OUTPUT = { entries: z.array(INBOX_ENTRY), remaining: z.number() };

export const INCLUDE_SEEN_FIELD = z
  .boolean()
  .optional()
  .describe("Re-read entries that were already marked as seen. Changes NO marker.");

const OPEN_QUESTIONS_FIELD = z
  .array(z.string())
  .optional()
  .describe(
    "A few (max. 10) short questions that are still open BEFORE the call and that only the principal can answer. They are asked while the phone is ringing, so the agent starts the conversation with the answers.",
  );

function decideFreelyField() {
  return z
    .string()
    .optional()
    .describe(
      "The authorisation - what the agent may commit to in the call WITHOUT asking back, e.g. 'appointment on any weekday between 9 and 12, up to 60 euros'. Phrase it concretely enough that a yes/no decision can be derived from it on the phone; vague frames ('flexible', 'sometime') do not help. Never invent one: take the frame from what the user has already said, otherwise leave the field out. WITHOUT this field the agent may commit to nothing and only passes every proposal on as a message. Hard prohibitions do NOT belong here, they belong in constraints.",
    );
}

function fallbackOrderField() {
  return z
    .string()
    .optional()
    .describe(
      "Preference order the agent works through on its own if the first choice does not work, e.g. 'Thursday morning first, otherwise Friday, otherwise next week'. Without this field it will not try any alternative on its own.",
    );
}

function onOutOfScopeField(outOfScopeValues) {
  return z
    .enum(outOfScopeValues)
    .optional()
    .describe(
      "What the agent does when an offer lies OUTSIDE decide_freely: 'take_message' (default) - record the offer with all details, pass it on and promise that the user will get back; 'decline' - politely refuse, without a counter-offer; 'accept_best' - accept and record the best offer made anyway. Set 'accept_best' ONLY when the user explicitly says that any option suits them. Not applied on every call path.",
    );
}

function mandateField(outOfScopeValues) {
  const mandate = z.object({
    decide_freely: decideFreelyField(),
    fallback_order: fallbackOrderField(),
    on_out_of_scope: onOutOfScopeField(outOfScopeValues),
  });
  return mandate
    .optional()
    .describe(
      "Optional advance MANDATE: the frame within which the agent may decide ITSELF in the conversation, instead of returning every question as a message. Through this the agent books NOTHING and gets NO calendar access - it only commits verbally to what the user allowed in advance. Ask the user about their frame when an appointment or price question is to be expected in the call; without a mandate the agent can only answer 'When suits you?' with 'I will pass that on'. In a conflict with constraints, constraints ALWAYS win.",
    );
}

function keyFactsField() {
  return z
    .array(z.string())
    .optional()
    .describe(
      "Only facts the agent must state correctly, e.g. names, dates; max. 10 short items. NO secrets/passwords/payment data.",
    );
}

function contextField() {
  const context = z.object({
    summary: z
      .string()
      .optional()
      .describe("Only so the agent can state why it calls: 1-3 sentences, not a copy of the chat."),
    key_facts: keyFactsField(),
    recipient_relationship: z
      .string()
      .optional()
      .describe(
        "Only if it sets the tone: how the principal knows the called party, e.g. 'regular hairdresser'.",
      ),
    desired_outcome: z
      .string()
      .optional()
      .describe(
        "Only so the agent knows when it is done: the result the principal wants, briefly.",
      ),
    open_questions: OPEN_QUESTIONS_FIELD,
  });
  return context
    .optional()
    .describe(
      "Optional structured BACKGROUND, only for what the briefing lacks: fill a subfield only when this call needs it. The agent speaks as the principal's personal AI assistant, NEVER as you. NO secrets; sensitive details only as needed.",
    );
}

function maxDurationField(durationCapS) {
  const seconds = z.number().int().positive();
  return seconds
    .max(durationCapS)
    .optional()
    .describe(
      "Optional upper bound for the call duration in seconds. The server derives the " +
        "effective limit from the remaining credit and only ever applies a SHORTER value " +
        "than that; it never extends a call.",
    );
}

function callRequestFields() {
  return {
    to: z
      .string()
      .describe(
        "Take the destination number over EXACTLY as the user gave it - copy the digits character by character, NEVER convert them or reshape them into E.164 (reshaping introduces digit errors; the server normalises deterministically). A national notation with a leading 0 is resolved by the server via the user's home country; international destinations need +XX/00XX - if a number looks like a foreign national format, ask the user for the international notation instead of guessing. Checked server-side by the safety gates (permission profile/allowlist, denylist, country).",
      ),
    objective: z
      .string()
      .describe(
        "The goal of the call as ONE speakable first-person sentence from the perspective of the calling assistant - it is read out VERBATIM to the called party right after the disclosure, BEFORE they answer. Phrase it the way a human states their concern on the phone, e.g. 'I would like to book a men's haircut for Max on Saturday morning.' NO bare-infinitive stub like 'Book an appointment'. ALWAYS name a concrete topic/occasion when it is known; if the topic itself is still unknown, ask the user FIRST, instead of sending off a vague task - a single missing detail is not a reason to ask, it belongs in the briefing or stays open. Background and details do NOT belong here, they belong in the briefing.",
      ),
    briefing: z
      .string()
      .optional()
      .describe(
        "Only the context this call needs: what it is about, the names involved, relevant preferences and history, the desired outcome and tone. SUMMARISE instead of copying in raw. NO secrets, passwords or payment data. Sensitive details only as needed. Write only what you KNOW: never script an answer for a detail you are missing. For each gap, decide: could you answer it yourself during the call from your own tools and context? Then leave the gap open and declare that in one line. Can only the principal know it? Then write the honest line that they will get back on it. Can anyone look it up? Then write nothing. The agent speaks as the principal's personal AI assistant, not as you; phrase the context from their perspective.",
      ),
    constraints: z
      .string()
      .optional()
      .describe(
        "Hard limits the agent must not cross in the conversation, e.g. 'Not before 10 am, at most 40 euros, do not promise a deposit.'",
      ),
  };
}

function languageField() {
  return z
    .string()
    .optional()
    .describe(
      `The language the agent SPEAKS in this call - one of: ${SUPPORTED_LANGUAGES.join(", ")}. ` +
        "Leave it out unless the user asked for a particular language: without it the call " +
        "is held in the principal's own language. An unsupported code is REJECTED with an " +
        "error instead of being ignored. This does NOT change the language of the mandatory " +
        "AI disclosure - that always follows the person being called.",
    );
}

function diagnosticField() {
  return z
    .boolean()
    .optional()
    .describe(
      "Leave this unset in normal use. The server keeps the raw transcript of a call to the user's OWN verified number for a limited period on its own, so the conversation can be analysed afterwards - you do NOT have to ask for it. Set it to false ONLY when the user explicitly does not want that transcript kept. For any other destination the field has no effect.",
    );
}

export function placeCallRequestSchema(begriffe) {
  return {
    ...callRequestFields(),
    mandate: mandateField(begriffe.MANDATE_OUT_OF_SCOPE_VALUES),
    context: contextField(),
    language: languageField(),
    max_duration_s: maxDurationField(begriffe.MAX_CALL_DURATION_CAP_S),
    diagnostic: diagnosticField(),
  };
}

export function placeCallInputSchema(begriffe) {
  return {
    ...placeCallRequestSchema(begriffe),
    confirmation_code: z
      .string()
      .optional()
      .describe(
        "Only the Hermes card can supply this, once the user confirms prepare_call (SAME arguments incl. briefing/context) - never guess or invent it. REQUIRED - without it the call is NOT placed.",
      ),
  };
}

export function callIdInputSchema() {
  return { call_id: z.string().describe("The call_id from place_call") };
}

export function awaitCallEventInputSchema() {
  return {
    ...callIdInputSchema(),
    after_event_id: z
      .string()
      .optional()
      .describe(
        "The event_id you last handled. Pass it so you do not receive the same question twice.",
      ),
  };
}

export function answerConsultInputSchema(begriffe) {
  const { WORKING, FINAL } = begriffe.CONSULT_ANSWER_MODE;
  return {
    ...callIdInputSchema(),
    event_id: z.string().describe("The event_id from await_call_event"),
    status: z
      .enum([WORKING, FINAL])
      .optional()
      .describe(
        '"working" = acknowledge immediately, no answers needed. "final" (default) = the answer.',
      ),
    answers: z
      .array(z.string())
      .optional()
      .describe(
        "One short answer per open question, in the order the questions were given. " +
          'Required unless status is "working".',
      ),
  };
}
