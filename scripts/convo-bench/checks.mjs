import { localeFor } from "../../src/i18n/locales.js";

export function expectedDisclosure(ownerName, language) {
  return localeFor(language).disclosure(ownerName);
}

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?\b/;
const TOOL_LOOP_EXHAUSTION_ROUNDTRIPS = 4;
export const GET_CONSULT_TOOL_NAME = "get_consult";
export const LOOK_UP_TOOL_NAME = "look_up";
const DISCLOSURE_LEAK_MARKER = "im Auftrag von";

function agentTexts(runResult) {
  return runResult.transcript.filter((t) => t.role === "agent").map((t) => t.text);
}

const LLM_FREE_OPENING_SAMPLE_COUNT = 1;

function freeAgentTexts(runResult) {
  return runResult.agentSamples
    .slice(LLM_FREE_OPENING_SAMPLE_COUNT)
    .flatMap((sample) => sample.sayTexts);
}

const DE_LANGUAGE = "de";
const DE_TRANSLITERATION_STEMS = Object.freeze([
  "bestaetig", "duerf", "erklaer", "fuer", "gespraech", "gruess", "haett", "hoer",
  "koenn", "moecht", "moeglich", "muess", "naechst", "natuerlich", "schoen", "spaet",
  "taeglich", "ueber", "ungefaehr", "verfueg", "waehl", "waer", "wuerd", "zurueck",
]);

function transliterationHits(text) {
  const lower = text.toLowerCase();
  return DE_TRANSLITERATION_STEMS.filter((stem) => lower.includes(stem));
}

function checkNoTransliteratedUmlautsDe(runResult) {
  const id = "no_transliterated_umlauts_de";
  const language = runResult.call.language;
  if (language !== DE_LANGUAGE) return { id, pass: true, detail: `n/a (language=${language})` };
  const hits = [...new Set(freeAgentTexts(runResult).flatMap(transliterationHits))];
  return {
    id,
    pass: hits.length === 0,
    detail: hits.length ? `Umlaut-Transliteration im Agententext: ${hits.join(", ")}` : "ok",
  };
}

function checkDisclosureFirst(runResult) {
  const id = "disclosure_first";
  if (runResult.call.direction !== "outbound") return { id, pass: true, detail: "n/a (inbound)" };
  const firstSay = runResult.agentSamples[0]?.sayTexts[0] || "";
  const expected = expectedDisclosure(runResult.ownerName, runResult.call.language);
  const pass = firstSay.startsWith(expected);
  return {
    id,
    pass,
    detail: pass ? "ok" : `erster Say beginnt nicht mit der Offenlegung: "${firstSay.slice(0, 80)}"`,
  };
}

function checkNoRawIsoDateSpoken(runResult) {
  const id = "no_raw_iso_date_spoken";
  const offender = agentTexts(runResult).find((t) => ISO_DATE_RE.test(t));
  return { id, pass: !offender, detail: offender ? `roh-ISO-Datum gesprochen: "${offender}"` : "ok" };
}

function checkFarewellBeforeTerminal(runResult, scenario) {
  const id = "farewell_before_terminal";
  if (runResult.endedVia !== "agent_hangup") return { id, pass: true, detail: "n/a (kein Agent-Hangup)" };
  if (scenario.expectDegradation) return { id, pass: true, detail: "n/a (Szenario testet Degradation)" };
  const loc = localeFor(runResult.call.language);
  const last = agentTexts(runResult).at(-1) || "";
  const isTerminalError = last === loc.turnErrorSpeech || last === loc.llmDegradedSpeech;
  return {
    id,
    pass: !isTerminalError,
    detail: isTerminalError ? `letzter Agenten-Turn ist ein Fehler-Text: "${last}"` : "ok",
  };
}

function checkNoVerbatimQuestionRepeat(runResult) {
  const id = "no_verbatim_question_repeat";
  const texts = agentTexts(runResult).map((t) => t.trim());
  const seen = new Set();
  for (const t of texts) {
    if (seen.has(t)) return { id, pass: false, detail: `Agenten-Turn wortgleich wiederholt: "${t}"` };
    seen.add(t);
  }
  return { id, pass: true, detail: "ok" };
}

const UMLAUT_FOLDING = Object.freeze([["ä", "ae"], ["ö", "oe"], ["ü", "ue"], ["ß", "ss"]]);

function foldForPhraseMatch(text) {
  let out = text.toLowerCase();
  for (const [umlaut, ascii] of UMLAUT_FOLDING) out = out.split(umlaut).join(ascii);
  return out;
}

function foldedHits(texts, substrings) {
  const folded = texts.map(foldForPhraseMatch);
  return substrings.filter((s) => folded.some((t) => t.includes(foldForPhraseMatch(s))));
}

function phraseDenylistResult({ id, runResult, substrings, fieldName, hitLabel }) {
  if (!substrings.length) return { id, pass: true, detail: `n/a (keine ${fieldName})` };
  const hits = foldedHits(agentTexts(runResult), substrings);
  return {
    id,
    pass: hits.length === 0,
    detail: hits.length ? `${hitLabel}: ${hits.join(", ")}` : "ok",
  };
}

function checkNoRedundantAskAboutBriefedInfo(runResult, scenario) {
  return phraseDenylistResult({
    id: "no_redundant_ask_about_briefed_info",
    runResult,
    substrings: scenario.mustNotAskSubstrings || [],
    fieldName: "mustNotAskSubstrings",
    hitLabel: "Heuristik-Treffer (kein Hard-Gate)",
  });
}

function checkNoInventedPromise(runResult, scenario) {
  return phraseDenylistResult({
    id: "no_invented_promise",
    runResult,
    substrings: scenario.mustNotPromiseSubstrings || [],
    fieldName: "mustNotPromiseSubstrings",
    hitLabel: "Zusage ohne Deckung (Heuristik, kein Hard-Gate)",
  });
}

function checkTurnCountWithinBudget(runResult, scenario) {
  const id = "turn_count_within_budget";
  const max = scenario.maxTurns;
  return { id, pass: runResult.turnCount <= max, detail: `${runResult.turnCount}/${max} Agenten-Turns` };
}

function turnRoundtrips(runResult) {
  return runResult.metricsParsed
    .filter((m) => m.kind === "turn" && Number.isFinite(m.payload.roundtrips))
    .map((m) => m.payload.roundtrips);
}

function checkNoToolLoopExhaustion(runResult) {
  const id = "no_tool_loop_exhaustion";
  const exhausted = turnRoundtrips(runResult).includes(TOOL_LOOP_EXHAUSTION_ROUNDTRIPS);
  return {
    id,
    pass: !exhausted,
    detail: exhausted ? "mind. 1 Turn mit roundtrips===4 (Tool-Loop ausgeschoepft)" : "ok",
  };
}

function turnFiredTools(runResult) {
  return runResult.metricsParsed
    .filter((m) => m.kind === "turn" && Array.isArray(m.payload.tools))
    .map((m) => m.payload.tools);
}

function toolFireCount(runResult, toolName) {
  return turnFiredTools(runResult).filter((tools) => tools.includes(toolName)).length;
}

function firedToolResult({ id, runResult, toolName, expectFired }) {
  const count = toolFireCount(runResult, toolName);
  const fired = count > 0;
  const pass = fired === expectFired;
  const label = expectFired ? `kein Turn feuerte ${toolName}` : `${count} Turn(s) feuerten ${toolName}`;
  return { id, pass, detail: pass ? "ok" : label, value: count };
}

function checkConsultFired(runResult) {
  return firedToolResult({ id: "consult_fired", runResult, toolName: GET_CONSULT_TOOL_NAME, expectFired: true });
}

function checkNoConsultFired(runResult) {
  return firedToolResult({ id: "no_consult_fired", runResult, toolName: GET_CONSULT_TOOL_NAME, expectFired: false });
}

function checkLookupFired(runResult) {
  return firedToolResult({ id: "lookup_fired", runResult, toolName: LOOK_UP_TOOL_NAME, expectFired: true });
}

function checkNoLookupFired(runResult) {
  return firedToolResult({ id: "no_lookup_fired", runResult, toolName: LOOK_UP_TOOL_NAME, expectFired: false });
}

function checkInboundNoDisclosureLeak(runResult) {
  const id = "inbound_no_disclosure_leak";
  if (runResult.call.direction !== "inbound") return { id, pass: true, detail: "n/a (outbound)" };
  const leak = agentTexts(runResult).find((t) => t.includes(DISCLOSURE_LEAK_MARKER));
  return { id, pass: !leak, detail: leak ? `Offenlegungsphrase im Inbound-Turn: "${leak}"` : "ok" };
}

function actionItemCount(runResult) {
  return (runResult.storeSnapshot.actionItems || []).length;
}

function checkMessageTaken(runResult) {
  const id = "message_taken";
  const pass = actionItemCount(runResult) > 0;
  return { id, pass, detail: pass ? "ok" : "keine actionItems im Store" };
}

function checkNoMessageTaken(runResult) {
  const id = "no_message_taken";
  const n = actionItemCount(runResult);
  return { id, pass: n === 0, detail: n === 0 ? "ok" : `${n} actionItems trotz Mandat` };
}

const MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP = 3;

function agentHangupDisciplineResult({ id, runResult, minTurns, tooEarlyLabel }) {
  if (runResult.endedVia !== "agent_hangup") return { id, pass: true, detail: "n/a (kein Agent-Hangup)" };
  const pass = runResult.turnCount >= minTurns;
  return {
    id,
    pass,
    detail: pass
      ? `Hangup erst nach ${runResult.turnCount} Agenten-Turns`
      : `${tooEarlyLabel} (${runResult.turnCount} Agenten-Turns, Minimum ${minTurns})`,
  };
}

function checkNoHangupOnUnintelligibleReply(runResult) {
  return agentHangupDisciplineResult({
    id: "no_hangup_on_unintelligible_reply",
    runResult,
    minTurns: MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP,
    tooEarlyLabel: "Agent legte direkt nach der unverstaendlichen Aeusserung auf",
  });
}

function checkNoEarlyAgentHangup(runResult, scenario) {
  return agentHangupDisciplineResult({
    id: "no_early_agent_hangup",
    runResult,
    minTurns: scenario.minTurnsBeforeAgentHangup ?? MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP,
    tooEarlyLabel: "Agent legte auf, bevor die Sache geklaert war",
  });
}

const HANDOFF_PHRASES = Object.freeze([
  "gebe ich weiter", "gebe das weiter", "leite ich weiter", "gebe ich durch",
  "richte ich aus", "sage ich bescheid", "melde sich", "meldet sich dann",
  "muss ich rueckfragen", "muss ich nachfragen", "kann ich nicht entscheiden",
]);
const MULTI_QUESTION_MIN_MARKS = 2;
const VALUE_ROUNDING = 1e4;

export const MEASUREMENT_CHECKS = Object.freeze([
  "opening_chars_before_yield", "handoff_rate", "one_question_per_turn", "roundtrips_per_turn",
]);

export const BENCH_MAX_OPENING_CHARS = 229;

function freeAgentTurns(runResult) {
  return runResult.agentSamples.slice(LLM_FREE_OPENING_SAMPLE_COUNT);
}

function freeAgentTurnTexts(runResult) {
  return freeAgentTurns(runResult).map((sample) => sample.sayTexts.join(" "));
}

function checkLookupTurnNotSilent(runResult) {
  const id = "lookup_turn_not_silent";
  const toolsByTurn = turnFiredTools(runResult);
  const textsByTurn = freeAgentTurnTexts(runResult);
  if (toolsByTurn.length !== textsByTurn.length) {
    return {
      id,
      pass: false,
      detail: `Turn-Zaehlung weicht ab: ${toolsByTurn.length} Metrik-Turns vs. ${textsByTurn.length} Text-Turns`,
    };
  }
  const silentTurns = toolsByTurn.filter(
    (tools, i) => tools.includes(LOOK_UP_TOOL_NAME) && !textsByTurn[i].trim(),
  ).length;
  return {
    id,
    pass: silentTurns === 0,
    detail: silentTurns === 0 ? "ok" : `${silentTurns} look_up-Turn(s) ohne gesprochenen Text`,
  };
}

function checkOpeningCharsBeforeYield(runResult, scenario) {
  const id = "opening_chars_before_yield";
  const chars = (runResult.agentSamples[0]?.sayTexts || []).join(" ").length;
  const max = scenario.maxOpeningChars;
  if (max == null) return { id, pass: true, detail: `n/a (kein maxOpeningChars, ${chars} Zeichen)`, value: chars };
  return { id, pass: chars <= max, detail: `${chars}/${max} Zeichen`, value: chars };
}

function checkHandoffRate(runResult) {
  const id = "handoff_rate";
  const language = runResult.call.language;
  if (language !== DE_LANGUAGE) return { id, pass: true, detail: `n/a (language=${language})`, value: null };
  const turns = freeAgentTurnTexts(runResult);
  if (!turns.length) return { id, pass: true, detail: "n/a (keine frei generierten Turns)", value: null };
  const hitTurns = turns.filter((t) => foldedHits([t], HANDOFF_PHRASES).length > 0).length;
  const rate = Math.round((hitTurns / turns.length) * VALUE_ROUNDING) / VALUE_ROUNDING;
  return { id, pass: true, detail: `${hitTurns}/${turns.length} Turns mit Weitergabe-Phrase`, value: rate };
}

function checkRecapPresent(runResult, scenario) {
  const id = "recap_present";
  const substrings = scenario.recapSubstrings || [];
  if (!substrings.length) return { id, pass: true, detail: "n/a (keine recapSubstrings)", value: null };
  const last = freeAgentTurnTexts(runResult).at(-1) || "";
  const present = foldedHits([last], substrings).length > 0;
  return { id, pass: present, detail: present ? "ok" : "kein Recap im letzten Agenten-Turn", value: present };
}

function checkMemoryFactRecalled(runResult, scenario) {
  const id = "memory_fact_recalled";
  const phrases = scenario.expectedMemoryPhrases || [];
  if (!phrases.length) return { id, pass: true, detail: "n/a (keine expectedMemoryPhrases)", value: null };
  const hits = foldedHits(freeAgentTurnTexts(runResult), phrases);
  return {
    id,
    pass: hits.length > 0,
    detail: hits.length ? `Treffer: ${hits.join(", ")}` : "kein Fakt aus Call 1 genannt",
    value: hits.length,
  };
}

function checkOneQuestionPerTurn(runResult, scenario) {
  const id = "one_question_per_turn";
  const multiQuestionTurns = freeAgentTurnTexts(runResult).filter(
    (t) => (t.match(/\?/g) || []).length >= MULTI_QUESTION_MIN_MARKS,
  ).length;
  const max = scenario.maxMultiQuestionTurns;
  const pass = max == null ? true : multiQuestionTurns <= max;
  const bound = max == null ? "" : ` (max ${max})`;
  return { id, pass, detail: `${multiQuestionTurns} Turn(s) mit >=2 Fragen${bound}`, value: multiQuestionTurns };
}

function checkRoundtripsPerTurn(runResult) {
  const id = "roundtrips_per_turn";
  const values = turnRoundtrips(runResult);
  if (!values.length) return { id, pass: true, detail: "n/a (keine turn-Metriken)", value: null };
  const mean = Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * VALUE_ROUNDING) / VALUE_ROUNDING;
  return { id, pass: true, detail: `Mittelwert ${mean} ueber ${values.length} Turns`, value: mean };
}

const RESULT_SLOT_MIN_HIT_RATE = 0.8;

function resultCardText(result) {
  if (!result) return "";
  const parts = [
    result.outcome,
    result.nextStep,
    ...(result.commitments || []),
    ...(result.counterpartyCommitments || []),
    ...(result.openPoints || []),
  ];
  return parts.filter(Boolean).join(" ");
}

function checkResultSlotsPresent(runResult, scenario) {
  const id = "result_slots_present";
  const expected = scenario.expectedResult || [];
  if (!expected.length) return { id, pass: true, detail: "n/a (kein expectedResult)", value: null };
  const cardText = foldForPhraseMatch(resultCardText(runResult.storeSnapshot.result));
  const hits = expected.filter((slot) => (slot.any || []).some((alt) => cardText.includes(foldForPhraseMatch(alt))));
  const rate = Math.round((hits.length / expected.length) * VALUE_ROUNDING) / VALUE_ROUNDING;
  return {
    id,
    pass: rate >= RESULT_SLOT_MIN_HIT_RATE,
    detail: `${hits.length}/${expected.length} Slots in der Ergebnis-Karte (${hits.map((s) => s.slot).join(", ") || "keine"})`,
    value: rate,
  };
}

const CHECKS = {
  disclosure_first: checkDisclosureFirst,
  no_raw_iso_date_spoken: checkNoRawIsoDateSpoken,
  farewell_before_terminal: checkFarewellBeforeTerminal,
  no_verbatim_question_repeat: checkNoVerbatimQuestionRepeat,
  no_redundant_ask_about_briefed_info: checkNoRedundantAskAboutBriefedInfo,
  no_invented_promise: checkNoInventedPromise,
  turn_count_within_budget: checkTurnCountWithinBudget,
  no_tool_loop_exhaustion: checkNoToolLoopExhaustion,
  inbound_no_disclosure_leak: checkInboundNoDisclosureLeak,
  message_taken: checkMessageTaken,
  no_message_taken: checkNoMessageTaken,
  no_hangup_on_unintelligible_reply: checkNoHangupOnUnintelligibleReply,
  no_early_agent_hangup: checkNoEarlyAgentHangup,
  no_transliterated_umlauts_de: checkNoTransliteratedUmlautsDe,
  opening_chars_before_yield: checkOpeningCharsBeforeYield,
  handoff_rate: checkHandoffRate,
  recap_present: checkRecapPresent,
  one_question_per_turn: checkOneQuestionPerTurn,
  roundtrips_per_turn: checkRoundtripsPerTurn,
  result_slots_present: checkResultSlotsPresent,
  memory_fact_recalled: checkMemoryFactRecalled,
  consult_fired: checkConsultFired,
  no_consult_fired: checkNoConsultFired,
  lookup_fired: checkLookupFired,
  no_lookup_fired: checkNoLookupFired,
  lookup_turn_not_silent: checkLookupTurnNotSilent,
};

export function runChecks(runResult, scenario) {
  const ids = scenario.checks || [];
  return ids.map((id) => {
    const fn = CHECKS[id];
    if (!fn) return { id, pass: false, detail: `unbekannter Check: ${id}` };
    return fn(runResult, scenario);
  });
}
