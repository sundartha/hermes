import { attemptReachedProvider, createLlmClient, createSecondaryLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { CONSULT_WAIT, MANDATE_OUT_OF_SCOPE_DEFAULT, resolveTimezone } from "./store/defaults.js";
import { bookTokenUsage, estimatedAbortUsage } from "./llm-usage.js";
import { providerTurnMessage, toolResultsMessage } from "./llm/messages.js";
import { makeSentenceChunker } from "./speech-chunker.js";
import { makeThinkingSignal } from "./thinking-signal.js";
import { shapeForSpeech } from "./speech-shape.js";
import { followUpToolChoiceFor, followUpToolsFor } from "./tool-follow-up.js";
import { localeFor } from "./i18n/locales.js";
import { metrics } from "./metrics.js";
import { MAX_TOOL_ROUNDS_PER_TURN, roundFitsDeadline, turnLoopDeadlineMs } from "./turn-budget.js";
import { blockingBudgetAxis } from "./budget-gate.js";
import { evidenceRetentionEnabled, normalizeCallResult } from "./call-result.js";
import { budgetedMemoryLines } from "./call-memory.js";
import { clampAtWordBoundary } from "./utils/text.js";
import {
  GET_CONSULT_TOOL_NAME,
  advanceConsultWait,
  consultAvailableFor,
  decideConsultRequest,
} from "./consult/in-call.js";
import { LOOK_UP_TOOL_NAME, lookupAvailableFor, performLookupRequest } from "./research/in-call.js";

const llm = createLlmClient({ config, metrics });

function promptInputs(call) {
  const ctx = store.tenantContext(call.tenantId);
  const loc = localeFor(call.language);
  const timeZone = resolveTimezone(store.tenantTimezone(call.tenantId));
  return {
    call,
    settings: ctx.settings,
    owner: ctx.firstName,
    loc,
    memory: counterpartyMemoryFor(call),
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
  return store.counterpartyMemory(call.tenantId, call.to);
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

export function systemPrompt(call) {
  const p = promptInputs(call);
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
    items: store.callActionItems(call.id),
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

const OPENING_GOAL_MAX_CHARS = 75;

const END_CALL_TOOL_NAME = "end_call";

export function openingText(call) {
  const opening = firstSpokenSentence(call);
  const goal = trimGoalForSpeech(call.goal);
  if (!goal) return opening;
  return `${opening} ${localeFor(call.language).bridgePhrase(goal)}`;
}

function firstSpokenSentence(call) {
  return ownerOpeningFor(call) || disclosureSentence(call);
}

function ownerOpeningFor(call) {
  if (call.calleeIsOwner !== true) return "";
  const firstName = store.tenantContext(call.tenantId).firstName;
  const name = typeof firstName === "string" ? firstName.trim() : "";
  if (!name) return "";
  return localeFor(call.language).ownerOpening(name);
}

function trimGoalForSpeech(goal) {
  const text = (goal || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  return clampAtWordBoundary(text, OPENING_GOAL_MAX_CHARS).replace(/[.!?]+$/, "");
}

const TAKE_MESSAGE_TOOL_NAME = "take_message";

const SIDE_EFFECT_ONLY_TOOL_NAMES = Object.freeze(
  new Set([END_CALL_TOOL_NAME, TAKE_MESSAGE_TOOL_NAME]),
);

export function isSideEffectOnlyTool(name) {
  return SIDE_EFFECT_ONLY_TOOL_NAMES.has(name);
}

const STREAM_SAFE_TOOL_NAMES = Object.freeze(
  new Set([END_CALL_TOOL_NAME, TAKE_MESSAGE_TOOL_NAME, LOOK_UP_TOOL_NAME, GET_CONSULT_TOOL_NAME]),
);

function isStreamSafeTool(name) {
  return STREAM_SAFE_TOOL_NAMES.has(name);
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

export function execTool(call, name, input) {
  const tc = localeFor(call.language).prompt.turnControl;
  switch (name) {
    case TAKE_MESSAGE_TOOL_NAME: {
      const { duplicate } = store.addActionItem(call.id, input.message, "todo");
      return duplicate ? tc.takeMessageDuplicateResult : tc.takeMessageResult;
    }
    case END_CALL_TOOL_NAME:
      return "OK";
    default:
      return tc.unknownTool;
  }
}

export function endCallWaitInstruction(call) {
  return localeFor(call.language).prompt.turnControl.endCallWait;
}

export function isSubstantialCallerText(text) {
  return typeof text === "string" && text.trim().length >= config.voice.callerSubstanceMinLen;
}

export function callerHasSpoken(call) {
  return call.direction === "outbound"
    ? call.transcript.some((t) => t.role === "caller" && isSubstantialCallerText(t.text))
    : call.transcript.some((t) => t.role === "caller");
}

function unansweredAgentTurns(transcript) {
  let count = 0;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    if (entry.role === "agent") {
      count += 1;
      continue;
    }
    if (isSubstantialCallerText(entry.text)) break;
  }
  return count;
}

export function shouldSuppressEndCall(call) {
  const substantialCallerSeen = callerHasSpoken(call);
  const emptyTurnsReached = unansweredAgentTurns(call.transcript) >= config.voice.maxEmptyTurns;
  return !substantialCallerSeen && !emptyTurnsReached;
}

export const TURN_STOP_DEADLINE = "deadline";

export const TURN_STOP_SUPERSEDED = "superseded";

function roundStopReason({ call, roundIndex, elapsedMs, deadlineMs }) {
  const axis = blockingBudgetAxis({ store, billing: config.billing, tenantId: call.tenantId });
  if (axis) return axis;
  if (roundIndex === 0) return null;
  const fits = roundFitsDeadline({
    elapsedMs,
    deadlineMs,
    requestTimeoutMs: config.llm.llmRequestTimeoutMs,
  });
  return fits ? null : TURN_STOP_DEADLINE;
}

function logTurnStop({ callId, grund, roundtrips }) {
  console.warn(`[turn] abbruch grund=${grund} call=${callId} runden=${roundtrips}`);
}

const TURN_MAX_TOKENS = 300;

function promptCharsOf({ system, tools, messages }) {
  return (
    JSON.stringify(system).length + JSON.stringify(tools).length + JSON.stringify(messages).length
  );
}

export function streamSinkFor({ onSpeechChunk, tools, elapsedMs, deadlineMs, continuesStream }) {
  if (!onSpeechChunk) return null;
  if (!tools.every((t) => isStreamSafeTool(t.name))) return null;
  if (
    !roundFitsDeadline({ elapsedMs, deadlineMs, requestTimeoutMs: config.llm.llmRequestTimeoutMs })
  )
    return null;
  return makeSentenceChunker({ onChunk: onSpeechChunk, continuesStream });
}

async function completeRound({ call, params, stream }) {
  const bookReal = (usage) => bookTokenUsage({ tenantId: call.tenantId, callId: call.id, usage });
  if (!stream) {
    const turn = await llm.complete(params);
    bookReal(turn.usage);
    return turn;
  }
  const promptChars = promptCharsOf(params);
  try {
    const turn = await llm.completeStream({
      ...params,
      sink: stream.sink,
      streamBudgetMs: stream.budgetMs,
    });
    bookReal(turn.usage);
    return turn;
  } catch (err) {
    if (attemptReachedProvider(err) || stream.sink.receivedText())
      bookReal(
        estimatedAbortUsage({
          promptChars,
          maxTokens: TURN_MAX_TOKENS,
          billingModelId: params.model,
        }),
      );
    throw err;
  }
}

function toolResultText({ call, toolCall, consult, lookup }) {
  if (toolCall.name === GET_CONSULT_TOOL_NAME) return consult.toolResult;
  if (toolCall.name === LOOK_UP_TOOL_NAME) return lookup.toolResult;
  return execTool(call, toolCall.name, toolCall.input);
}

function consultTurnMarker(consultWait, turnControl) {
  if (consultWait === CONSULT_WAIT.ANSWERED) return turnControl.consultAnswered;
  if (consultWait === CONSULT_WAIT.PENDING) return turnControl.consultPending;
  if (consultWait === CONSULT_WAIT.TIMED_OUT) return turnControl.consultTimeout;
  return "";
}

export async function agentTurn(call, callerText, { onSpeechChunk, abortSignal } = {}) {
  if (callerText) {
    store.addTranscript(call.id, "caller", callerText);
    store.countCallerTurn(call.id);
  }

  const consultWait = advanceConsultWait(call);
  const holdSpeech =
    consultWait === CONSULT_WAIT.HOLD ? localeFor(call.language).consultHoldSpeech : "";

  const history = call.transcript.slice(-24).map((t) => ({
    role: t.role === "agent" ? "assistant" : "user",
    content: t.text,
  }));
  if (!history.length || history[history.length - 1].role !== "user") {
    const hasAgentLine = call.transcript.some((t) => t.role === "agent");
    const tc = localeFor(call.language).prompt.turnControl;
    history.push({
      role: "user",
      content: hasAgentLine
        ? tc.silentTurn
        : call.direction === "outbound"
          ? tc.openingBootstrap.outbound
          : tc.openingBootstrap.inbound,
    });
  }

  const consultMarker = consultTurnMarker(consultWait, localeFor(call.language).prompt.turnControl);
  if (consultMarker) {
    const last = history[history.length - 1];
    last.content = `${last.content}\n${consultMarker}`;
  }

  const suppressEndCall = shouldSuppressEndCall(call);

  let messages = history;
  let endCall = false;
  let suppressedEndCall = false;
  let speech = "";
  let speechStreamed = false;
  let wireHasSpeech = false;
  const thinkingSignal = makeThinkingSignal({
    onSpeechChunk,
    enabled: config.voice.thinkingSignalEnabled,
  });
  let roundtrips = 0;
  const firedTools = [];
  const offeredTools = new Set();
  let streamArmedRounds = 0;

  const model = config.llm.claudeModel;

  const loopStartedAt = Date.now();
  const deadlineMs = turnLoopDeadlineMs(config.voice.elevenLabsPlayTts.synthTimeoutMs);
  let stopReason = null;

  let pendingFollowUp = null;
  let followUpUsed = false;

  for (let i = 0; i < MAX_TOOL_ROUNDS_PER_TURN; i++) {
    if (abortSignal?.aborted) {
      stopReason = TURN_STOP_SUPERSEDED;
      break;
    }
    stopReason = roundStopReason({
      call,
      roundIndex: i,
      elapsedMs: Date.now() - loopStartedAt,
      deadlineMs,
    });
    if (stopReason) break;

    if (holdSpeech) {
      speech = holdSpeech;
      break;
    }

    const followUp = pendingFollowUp;
    pendingFollowUp = null;
    const tools = followUp?.tools ?? agentTools(call);
    for (const tool of tools) offeredTools.add(tool.name);
    const elapsedMs = Date.now() - loopStartedAt;
    const sink = streamSinkFor({
      onSpeechChunk,
      tools,
      elapsedMs,
      deadlineMs,
      continuesStream: wireHasSpeech,
    });
    if (sink) streamArmedRounds += 1;
    const params = {
      model,
      maxTokens: TURN_MAX_TOKENS,
      system: systemPrompt(call),
      tools,
      messages,
      cachePrefix: true,
      callId: call.id,
      ...(followUp ? { toolChoice: followUp.toolChoice } : {}),
    };
    let turn;
    try {
      turn = await completeRound({
        call,
        params,
        stream: sink && { sink, budgetMs: deadlineMs - elapsedMs },
      });
    } catch (err) {
      if (!followUp) throw err;
      console.warn(`[turn] nachfassen-fehlgeschlagen call=${call.id} runden=${roundtrips}`);
      break;
    }
    roundtrips += 1;
    if (sink) {
      sink.flushRemainder();
      if (sink.chunkCount() > 0) wireHasSpeech = true;
    }

    if (turn.text) {
      speech = turn.text;
      speechStreamed = Boolean(sink);
    }

    const toolCalls = turn.toolCalls;
    firedTools.push(...toolCalls.map((tc) => tc.name));
    if (!toolCalls.length) {
      const followUpTools = followUpToolsFor({
        enabled: config.voice.toolFollowUpEnabled,
        alreadyUsed: followUpUsed,
        text: turn.text,
        language: call.language,
        candidateTools: tools.filter((t) => t.name !== END_CALL_TOOL_NAME),
      });
      if (!followUpTools) break;
      followUpUsed = true;
      pendingFollowUp = {
        tools: followUpTools,
        toolChoice: followUpToolChoiceFor({
          text: turn.text,
          language: call.language,
          candidateTools: followUpTools,
          consultToolName: GET_CONSULT_TOOL_NAME,
        }),
      };
      messages = [
        ...messages,
        providerTurnMessage(turn.providerTurn),
        { role: "user", content: localeFor(call.language).prompt.followUp.nudge },
      ];
      continue;
    }

    const consult = decideConsultRequest(call, toolCalls);
    if (consult?.accepted) {
      if (!speechStreamed) speech = consult.speech;
      break;
    }

    if (toolCalls.some((tc) => tc.name === END_CALL_TOOL_NAME)) {
      if (suppressEndCall) suppressedEndCall = true;
      else endCall = true;
    }
    const sideEffectOnlyRound = toolCalls.every((tc) => isSideEffectOnlyTool(tc.name));
    const loopContinues = !(speech && (endCall || suppressedEndCall || sideEffectOnlyRound));

    const bridgeText = loopContinues && !speechStreamed && thinkingSignal.speakBridge(speech);
    if (bridgeText) {
      speech = bridgeText;
      speechStreamed = true;
    }

    const lookup = await performLookupRequest({ call, toolUses: toolCalls, loopContinues });

    messages = [
      ...messages,
      providerTurnMessage(turn.providerTurn),
      toolResultsMessage(
        toolCalls.map((tc) => {
          const waitsForAnswer = tc.name === END_CALL_TOOL_NAME && suppressEndCall;
          return {
            toolCallId: tc.id,
            text: waitsForAnswer
              ? endCallWaitInstruction(call)
              : toolResultText({ call, toolCall: tc, consult, lookup }),
          };
        }),
      ),
    ];
    if (!loopContinues) break;
  }

  if (stopReason) logTurnStop({ callId: call.id, grund: stopReason, roundtrips });

  metrics.logTurn({
    callId: call.id,
    direction: call.direction,
    roundtrips,
    tools: firedTools,
  });

  const turnTelemetry = () => ({
    roundtrips,
    toolNames: firedTools,
    offeredToolNames: [...offeredTools],
    streamArmedRounds,
    stopReason,
  });

  if (abortSignal?.aborted)
    return {
      speech: "",
      speechStreamed: false,
      thinkingSignalSpoken: thinkingSignal.spoken(),
      endCall: false,
      superseded: true,
      ...turnTelemetry(),
    };

  speech = shapeForSpeech(speech);
  if (!speech) {
    speech = localeFor(call.language).turnFallbackSpeech[call.direction];
    speechStreamed = false;
  }
  store.addTranscript(call.id, "agent", speech);
  return {
    speech,
    speechStreamed,
    thinkingSignalSpoken: thinkingSignal.spoken(),
    endCall,
    superseded: false,
    ...turnTelemetry(),
  };
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
  const ctx = store.tenantContext(call.tenantId);
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
    items: store.callActionItems(call.id),
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
    system: loc.summarySystem(owner) + (evidenceAllowed ? loc.summaryEvidenceClause : ""),
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

  call.summary = parsed.summary || null;
  call.objectiveAchieved = parsed.objective_achieved ?? "unclear";
  call.result = normalizeCallResult(parsed, { evidenceAllowed });
  store.save();
  for (const item of parsed.actionItems || []) store.addActionItem(call.id, item, "todo");
  return parsed;
}
