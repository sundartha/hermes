// Deterministische Binary-Checks (tasks/convo-bench-spec.md §5-i). Jede Check-Funktion
// ist eine reine Funktion (runResult, scenarioConfig) => {id, pass, detail}. Kein
// Netz-Zugriff hier - nur die reinen i18n-Locale-Strings (kein Store-Import: siehe
// expectedDisclosure-Kommentar unten fuer die bewusste Abweichung von claude.js).
import { localeFor } from "../../src/i18n/locales.js";

// Abweichung von der Spec-Formulierung "disclosureSentence(call) aus src/claude.js
// importieren": disclosureSentence(call) laedt intern store.tenantContext(call.tenantId)
// - das waere der Store DIESES Bench-Prozesses (anderes DATA_DIR als der gespawnte
// Server-Kindprozess) und laege damit potenziell falsch/leer. Die Bench kennt den
// geseedeten ownerName selbst (identisch zu OWNER_TEST_FIRST_NAME/_LAST_NAME aus
// test/helpers.js) - die pure i18n-Funktion liefert denselben Wortlaut ohne
// Store-Abhaengigkeit (localeFor ist nachweislich seiteneffektfrei, siehe runner.mjs).
export function expectedDisclosure(ownerName, language) {
  return localeFor(language).disclosure(ownerName);
}

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?\b/;
const GENERIC_TITLE = "Termin";
const TOOL_LOOP_EXHAUSTION_ROUNDTRIPS = 4;
// Phrasen-Fragment, das NUR in der Offenlegung vorkommt (disclosure-Bundle, alle
// Sprachen) - fuer den Inbound-Leak-Check reicht die deutsche Variante, da die Bench
// ausschliesslich mit language="de" seedet (siehe runner.mjs buildCallSeed).
const DISCLOSURE_LEAK_MARKER = "im Auftrag von";

function agentTexts(runResult) {
  return runResult.transcript.filter((t) => t.role === "agent").map((t) => t.text);
}

function checkDisclosureFirst(runResult) {
  const id = "disclosure_first";
  if (runResult.call.direction !== "outbound") return { id, pass: true, detail: "n/a (inbound)" };
  const firstSay = runResult.texmlSamples[0]?.sayTexts[0] || "";
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

// Best-effort-Heuristik (Spec §5-i/§Risiken): NIEMALS zum Hard-Gate hochstufen -
// Overfitting-Risiko auf konkreten Wortlaut. pass bleibt informativ, kein hartes Fail
// im Sinne von "Bench ist kaputt", sondern ein Befund fuer den Judge/Owner.
function checkNoRedundantAskAboutBriefedInfo(runResult, scenario) {
  const id = "no_redundant_ask_about_briefed_info";
  const substrings = scenario.mustNotAskSubstrings || [];
  if (!substrings.length) return { id, pass: true, detail: "n/a (keine mustNotAskSubstrings)" };
  const lowerTexts = agentTexts(runResult).map((t) => t.toLowerCase());
  const hits = substrings.filter((s) => lowerTexts.some((t) => t.includes(s.toLowerCase())));
  return {
    id,
    pass: hits.length === 0,
    detail: hits.length ? `Heuristik-Treffer (kein Hard-Gate): ${hits.join(", ")}` : "ok",
  };
}

function checkBookedWithNongenericTitle(runResult, scenario) {
  const id = "booked_with_nongeneric_title";
  if (!scenario.expectBooking) return { id, pass: true, detail: "n/a (kein expectBooking)" };
  const events = runResult.storeSnapshot.calendarNewEvents || [];
  const booked = events.find((e) => e.title && e.title !== GENERIC_TITLE);
  return {
    id,
    pass: Boolean(booked),
    detail: booked ? `gebucht: "${booked.title}"` : "kein nicht-generischer Kalendereintrag gefunden",
  };
}

function checkTurnCountWithinBudget(runResult, scenario) {
  const id = "turn_count_within_budget";
  const max = scenario.maxTurns;
  return { id, pass: runResult.turnCount <= max, detail: `${runResult.turnCount}/${max} Agenten-Turns` };
}

function checkNoToolLoopExhaustion(runResult) {
  const id = "no_tool_loop_exhaustion";
  const exhausted = runResult.metricsParsed.some(
    (m) => m.kind === "turn" && m.payload.roundtrips === TOOL_LOOP_EXHAUSTION_ROUNDTRIPS,
  );
  return {
    id,
    pass: !exhausted,
    detail: exhausted ? "mind. 1 Turn mit roundtrips===4 (Tool-Loop ausgeschoepft)" : "ok",
  };
}

function checkInboundNoDisclosureLeak(runResult) {
  const id = "inbound_no_disclosure_leak";
  if (runResult.call.direction !== "inbound") return { id, pass: true, detail: "n/a (outbound)" };
  const leak = agentTexts(runResult).find((t) => t.includes(DISCLOSURE_LEAK_MARKER));
  return { id, pass: !leak, detail: leak ? `Offenlegungsphrase im Inbound-Turn: "${leak}"` : "ok" };
}

function checkMessageTaken(runResult) {
  const id = "message_taken";
  if (runResult.call.direction !== "inbound") return { id, pass: true, detail: "n/a (outbound)" };
  const pass = (runResult.storeSnapshot.actionItems || []).length > 0;
  return { id, pass, detail: pass ? "ok" : "keine actionItems im Store" };
}

// afix-p4 (RCA R3): Der Agent darf nach einer unverstaendlichen Aeusserung nicht SOFORT
// auflegen - genau der Live-Defekt. texmlSamples[0] ist das Opening, texmlSamples[1] die
// erste Reaktion auf die Aeusserung des Gegenuebers; ein agent_hangup mit turnCount <= 2
// heisst also "aufgelegt statt nachgefragt" (G25: benannte Konstante statt nackter 2/3).
const MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP = 3;

function checkNoHangupOnUnintelligibleReply(runResult) {
  const id = "no_hangup_on_unintelligible_reply";
  if (runResult.endedVia !== "agent_hangup") return { id, pass: true, detail: "n/a (kein Agent-Hangup)" };
  const pass = runResult.turnCount >= MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP;
  return {
    id,
    pass,
    detail: pass
      ? `Hangup erst nach ${runResult.turnCount} Agenten-Turns`
      : `Agent legte direkt nach der unverstaendlichen Aeusserung auf (${runResult.turnCount} Agenten-Turns)`,
  };
}

// EIN Registry-Objekt statt verstreuter switch/if-Ketten (G23) - jede Check-Funktion
// entscheidet selbst per n/a-Pass, ob sie fuer Richtung/Szenario ueberhaupt zutrifft.
const CHECKS = {
  disclosure_first: checkDisclosureFirst,
  no_raw_iso_date_spoken: checkNoRawIsoDateSpoken,
  farewell_before_terminal: checkFarewellBeforeTerminal,
  no_verbatim_question_repeat: checkNoVerbatimQuestionRepeat,
  no_redundant_ask_about_briefed_info: checkNoRedundantAskAboutBriefedInfo,
  booked_with_nongeneric_title: checkBookedWithNongenericTitle,
  turn_count_within_budget: checkTurnCountWithinBudget,
  no_tool_loop_exhaustion: checkNoToolLoopExhaustion,
  inbound_no_disclosure_leak: checkInboundNoDisclosureLeak,
  message_taken: checkMessageTaken,
  no_hangup_on_unintelligible_reply: checkNoHangupOnUnintelligibleReply,
};

// Nur die vom Szenario deklarierten Check-IDs laufen lassen (scenario.checks: string[]).
export function runChecks(runResult, scenario) {
  const ids = scenario.checks || [];
  return ids.map((id) => {
    const fn = CHECKS[id];
    if (!fn) return { id, pass: false, detail: `unbekannter Check: ${id}` };
    return fn(runResult, scenario);
  });
}
