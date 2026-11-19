import { createSecondaryLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { speicherBereiche } from "./store.js";
import { MANDATE_OUT_OF_SCOPE_DEFAULT } from "./begriffe/anrufe.js";
import { resolveTimezone } from "./begriffe/sprache-zeit.js";
import { bookTokenUsage } from "./llm-usage.js";
import { localeFor } from "./i18n/locales.ts";
import { metrics } from "./metrics.js";
import { evidenceRetentionEnabled, normalizeCallResult } from "./call-result.ts";
import { budgetedMemoryLines } from "./call-memory.ts";
import { GET_CONSULT_TOOL_NAME, consultAvailableFor } from "./consult/in-call.js";
import { LOOK_UP_TOOL_NAME, lookupAvailableFor } from "./research/in-call.js";

const bereiche = speicherBereiche(store);

function promptInputs(call, memory) {
  const ctx = store.tenantContext(call.tenantId);
  const loc = localeFor(call.language);
  const timeZone = resolveTimezone(store.tenantTimezone(call.tenantId));
  return {
    call,
    settings: ctx.settings,
    owner: ctx.firstName,
    loc,
    memory,
    lookupAvailable: lookupAvailableFor(call),
    consultAvailable: consultAvailableFor(call),
    mandateScopeGiven: Boolean(call.mandate && call.mandate.decide_freely),
    now: new Date().toLocaleString(loc.dateLocale, {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    isInbound: call.direction === "inbound",
    calleeIsOwner: call.calleeIsOwner === true,
  };
}

function counterpartyMemoryFor(call) {
  if (call.direction !== "outbound") return [];
  return store.counterpartyMemoryGelesen(call.tenantId, call.to);
}

function personaHeader(p) {
  return p.loc.prompt.persona(p);
}

function assignmentBlock(p) {
  const { call, loc } = p;
  const t = loc.prompt;
  const lines = [`${t.goalLabel} ${call.goal}`];
  if (call.briefing) lines.push(`${t.briefingLabel} ${call.briefing}`);
  if (call.constraints) lines.push(`${t.constraintsLabel} ${call.constraints}`);
  return lines.join("\n") + assistantContextSection(p) + callMemorySection(p);
}

function outboundSituation(p) {
  const situation = p.calleeIsOwner
    ? p.loc.prompt.situationOutboundOwner(p)
    : p.loc.prompt.situationOutbound(p);
  return `${situation}\n\n${assignmentBlock(p)}`;
}

function inboundSituation(p) {
  return p.loc.prompt.situationInbound(p);
}

function speechRules(p) {
  return p.loc.prompt.speechRules(p);
}

function clarificationRules(p) {
  return p.loc.prompt.clarificationRules({ identityLine: identityLineFor(p) });
}

function identityLineFor(inputs) {
  const lines = inputs.loc.prompt.identityLines;
  if (inputs.isInbound) return lines.inbound(inputs.owner);
  if (!inputs.calleeIsOwner) return lines.outbound(inputs.owner);
  return lines.outboundOwner({ owner: inputs.owner, disclosure: disclosureSentence(inputs.call) });
}

function researchBoundaryLine(b, { lookupAvailable, consultAvailable }) {
  if (lookupAvailable) return b.lookupAllowed;
  return consultAvailable ? b.noLookupWithConsult : b.noLookup;
}

function boundaryRules({
  loc,
  settings: s,
  owner,
  lookupAvailable,
  consultAvailable,
  mandateScopeGiven,
}) {
  const b = loc.prompt.boundaries;
  const lines = [b.heading];
  if (!s.allowPersonalData) lines.push(b.personalData(owner));
  if (!s.allowBankData) lines.push(b.bankData);
  lines.push(
    b.noCalendar(owner),
    mandateScopeGiven ? b.noBookingWithMandate : b.noBooking,
    researchBoundaryLine(b, { lookupAvailable, consultAvailable }),
    consultAvailable
      ? b.noAskingCounterpartAboutOwnerWithConsult(owner)
      : b.noAskingCounterpartAboutOwner(owner),
    b.toolThrift,
  );
  return lines.join("\n");
}

function hasMandateContent(mandate) {
  return Boolean(
    mandate && (mandate.decide_freely || mandate.fallback_order || mandate.on_out_of_scope),
  );
}

function outOfScopeSentenceFor(mp, onOutOfScope, consultAvailable) {
  const key = mp.outOfScopeSentence[onOutOfScope] ? onOutOfScope : MANDATE_OUT_OF_SCOPE_DEFAULT;
  const withConsult = consultAvailable ? mp.outOfScopeSentenceWithConsult[key] : null;
  return withConsult || mp.outOfScopeSentence[key];
}

function mandateSection({ call, owner, loc, consultAvailable, mandateScopeGiven }) {
  const m = call.mandate;
  if (!hasMandateContent(m)) return "";
  const mp = loc.prompt.mandate;
  const outOfScope = outOfScopeSentenceFor(mp, m.on_out_of_scope, consultAvailable);
  const precedence = call.constraints ? mp.constraintsPrecedence : "";
  const blocks = [];
  if (mandateScopeGiven)
    blocks.push(`${mp.scopeLabel} ${m.decide_freely}\n${mp.scopeRules}${precedence}`);
  if (m.fallback_order) blocks.push(`${mp.fallbackLabel} ${m.fallback_order}\n${mp.fallbackRules}`);
  blocks.push(`${mp.outOfScopeLabel} ${outOfScope(owner)}\n${mp.outOfScopeRules}`);
  return blocks.join("\n\n");
}

function thinkingSignalRules(p) {
  return config.voice.thinkingSignalEnabled ? p.loc.prompt.thinkingSignal : "";
}

function consultRules(p) {
  return p.consultAvailable ? p.loc.prompt.consultRules(p.owner) : "";
}

export function systemPrompt(call, memory = counterpartyMemoryFor(call)) {
  const p = promptInputs(call, memory);
  return [
    personaHeader(p),
    p.isInbound ? inboundSituation(p) : outboundSituation(p),
    speechRules(p),
    clarificationRules(p),
    boundaryRules(p),
    thinkingSignalRules(p),
    consultRules(p),
    mandateSection(p),
    recordedMessagesSection(p),
    p.isInbound ? p.loc.prompt.outcomeInbound : p.loc.prompt.outcomeOutbound,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function assistantContextSection({ call, loc }) {
  if (!config.tenancy.assistantContextEnabled || !call.context) return "";
  const c = call.context;
  const b = loc.prompt.background;
  const lines = [];
  if (c.summary) lines.push(`${b.summary}${c.summary}`);
  if (c.recipient_relationship) lines.push(`${b.relationship}${c.recipient_relationship}`);
  if (c.desired_outcome) lines.push(`${b.outcome}${c.desired_outcome}`);
  if (Array.isArray(c.key_facts) && c.key_facts.length)
    lines.push(`${b.facts}${c.key_facts.join("; ")}`);
  if (!lines.length) return "";
  return `\n${b.heading}\n${lines.join("\n")}\n${b.guardrail}`;
}

function recordedItemsBlock({ items, heading, guardrail }) {
  if (!items.length) return "";
  return `${heading}\n${items.map((item) => `- ${item.text}`).join("\n")}\n${guardrail}`;
}

function recordedMessagesSection({ call, loc }) {
  const b = loc.prompt.recorded;
  return recordedItemsBlock({
    items: store.callActionItemsGespiegelt(call.id),
    heading: b.heading,
    guardrail: b.guardrail,
  });
}

function callMemorySection({ memory, loc }) {
  const lines = budgetedMemoryLines(memory);
  if (!lines.length) return "";
  const m = loc.prompt.memory;
  return `\n${m.heading}\n${lines.map((line) => `${m.entryPrefix}${line}`).join("\n")}\n${m.guardrail}`;
}

export function disclosureSentence(call) {
  const name = store.tenantContext(call.tenantId).ownerName;
  return localeFor(call.language).disclosure(name);
}

const END_CALL_TOOL_NAME = "end_call";

const TAKE_MESSAGE_TOOL_NAME = "take_message";

const SIDE_EFFECT_ONLY_TOOL_NAMES = Object.freeze(
  new Set([END_CALL_TOOL_NAME, TAKE_MESSAGE_TOOL_NAME]),
);

export function isSideEffectOnlyTool(name) {
  return SIDE_EFFECT_ONLY_TOOL_NAMES.has(name);
}

export function toolDefs(language) {
  const t = localeFor(language).prompt.tools;
  return [
    {
      name: END_CALL_TOOL_NAME,
      description: t.endCallDescription,
      parameters: {
        type: "object",
        properties: { reason: { type: "string", description: t.endCallReasonParam } },
        required: [],
      },
    },
    {
      name: TAKE_MESSAGE_TOOL_NAME,
      description: t.takeMessageDescription,
      parameters: {
        type: "object",
        properties: { message: { type: "string", description: t.takeMessageParam } },
        required: ["message"],
      },
    },
  ];
}

function getConsultToolDef(language) {
  const t = localeFor(language).prompt.tools;
  return {
    name: GET_CONSULT_TOOL_NAME,
    description: t.getConsultDescription,
    parameters: {
      type: "object",
      properties: { question: { type: "string", description: t.getConsultQuestionParam } },
      required: ["question"],
    },
  };
}

export function agentTools(call) {
  const tools = toolDefs(call.language);
  if (consultAvailableFor(call)) tools.push(getConsultToolDef(call.language));
  if (lookupAvailableFor(call)) tools.push(lookUpToolDef(call.language));
  return tools;
}

function lookUpToolDef(language) {
  const t = localeFor(language).prompt.tools;
  return {
    name: LOOK_UP_TOOL_NAME,
    description: t.lookUpDescription,
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: t.lookUpQueryParam } },
      required: ["query"],
    },
  };
}

export const agentToolNames = () => toolDefs().map((t) => t.name);

export function isSubstantialCallerText(text) {
  return typeof text === "string" && text.trim().length >= config.voice.callerSubstanceMinLen;
}

const SUMMARY_MAX_TOKENS = 800;

const SUMMARY_MAX_RETRIES = 1;

const summaryLlm = createSecondaryLlmClient({
  config,
  requestTimeoutMs: config.llm.summaryTimeoutMs,
  maxRetries: SUMMARY_MAX_RETRIES,
  metrics,
});

export async function summarizeCall(call) {
  const ctx = await bereiche.mandant.tenantContext(call.tenantId);
  const s = ctx.settings;
  const owner = ctx.ownerName;
  if (!s.allowSummaries) return null;
  if (!call.transcript.length) return null;

  const loc = localeFor(call.language);
  const si = loc.prompt.summaryInput;
  const convo = call.transcript
    .map((t) => `${t.role === "agent" ? si.agentRole : si.callerRole}: ${t.text}`)
    .join("\n");

  const alreadyRecorded = recordedItemsBlock({
    items: await bereiche.posteingang.callActionItems(call.id),
    heading: loc.prompt.recorded.heading,
    guardrail: loc.prompt.recorded.summaryGuardrail,
  });
  const summaryInputText =
    `${si.directionLabel} ${call.direction}` +
    (call.goal ? `\n${si.goalLabel} ${call.goal}` : "") +
    `\n\n${si.transcriptLabel}\n${convo}` +
    (alreadyRecorded ? `\n\n${alreadyRecorded}` : "");

  const model = config.llm.claudeModel;
  const evidenceAllowed = evidenceRetentionEnabled(config.privacy);
  const turn = await summaryLlm.complete({
    model,
    maxTokens: SUMMARY_MAX_TOKENS,
    system:
      loc.summarySystem(owner) + loc.summaryNextStepsClause + (evidenceAllowed ? loc.summaryEvidenceClause : ""),
    messages: [
      {
        role: "user",
        content: summaryInputText,
      },
    ],
    callId: call.id,
  });
  bookTokenUsage({ tenantId: call.tenantId, callId: call.id, usage: turn.usage });

  let parsed = { summary: "", actionItems: [] };
  try {
    const raw = turn.text || "{}";
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    parsed.summary = turn.text;
  }

  call.summary = parsed.summary || call.summary || null;
  call.objectiveAchieved = parsed.objective_achieved ?? "unclear";
  call.result = normalizeCallResult(parsed, { evidenceAllowed });
  store.save();
  for (const item of parsed.actionItems || []) await bereiche.posteingang.addActionItem(call.id, item, "todo");
  return parsed;
}
