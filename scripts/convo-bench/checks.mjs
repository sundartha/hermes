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
const TOOL_LOOP_EXHAUSTION_ROUNDTRIPS = 4;
// Phrasen-Fragment, das NUR in der Offenlegung vorkommt (disclosure-Bundle, alle
// Sprachen) - fuer den Inbound-Leak-Check reicht die deutsche Variante, da die Bench
// ausschliesslich mit language="de" seedet (siehe runner.mjs buildCallSeed).
const DISCLOSURE_LEAK_MARKER = "im Auftrag von";

function agentTexts(runResult) {
  return runResult.transcript.filter((t) => t.role === "agent").map((t) => t.text);
}

// Nur der FREI GENERIERTE Agententext (P4). texmlSamples[0] ist die LLM-freie Eroeffnung
// - Offenlegung + Auftragssatz stammen aus dem Locale-Bundle bzw. dem Szenario-Goal und
// sagen nichts ueber die Schreibweise des MODELLS aus. Wuerde der Umlaut-Check sie
// mitlesen, naegelte er sich auf unsere eigene Fixture fest statt auf die Modell-Ausgabe.
const LLM_FREE_OPENING_SAMPLE_COUNT = 1;

function freeAgentTexts(runResult) {
  return runResult.texmlSamples
    .slice(LLM_FREE_OPENING_SAMPLE_COUNT)
    .flatMap((sample) => sample.sayTexts);
}

// Check 12 (P4): ASCII-Transliteration von Umlauten im frei generierten Agententext.
// Bewusst eine DENYLIST konkreter Wortstaemme statt einer /ue|oe|ae/-Regex: die blosse
// Buchstabenfolge kommt in korrektem Deutsch vor ("neue", "Steuer", "Israel", "Poet") -
// die hier gelisteten Staemme dagegen ausschliesslich als Umlaut-Ersatzschreibung.
// Seit P1 tragen alle gesprochenen DE-Locale-Strings echte Umlaute (gepinnt in
// test/de-umlaut-orthography.test.js); ein Treffer stammt daher aus Modell-Text.
// Dieser Check faltet ABSICHTLICH NICHT (anders als foldForPhraseMatch unten) - die
// Unterscheidung der beiden Schreibweisen IST sein einziger Zweck.
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

// Vergleichs-Normalform der Phrasen-Heuristiken: klein + Umlaute auf ihre ASCII-
// Ersatzschreibung gefaltet. OHNE diese Faltung wuerde dieselbe Phrase je nach
// Schreibweise des Modells mal treffen und mal nicht - und ausgerechnet P5 aendert diese
// Schreibweise, der A/B-Vergleich waere damit nicht mehr interpretierbar. Deshalb sind
// die Needles in den Szenarien in der GEFALTETEN Form notiert.
const UMLAUT_FOLDING = Object.freeze([["ä", "ae"], ["ö", "oe"], ["ü", "ue"], ["ß", "ss"]]);

function foldForPhraseMatch(text) {
  let out = text.toLowerCase();
  for (const [umlaut, ascii] of UMLAUT_FOLDING) out = out.split(umlaut).join(ascii);
  return out;
}

// Best-effort-Heuristik: NIEMALS zum Hard-Gate hochstufen - Overfitting-Risiko auf
// konkreten Wortlaut. Ein Treffer ist ein Befund fuer Judge/Owner, kein "Bench kaputt".
// EINE Implementierung fuer beide Phrasen-Checks (G5) - sie unterscheiden sich nur in
// Check-ID, Szenario-Feld und Befund-Text.
function phraseDenylistResult({ id, runResult, substrings, fieldName, hitLabel }) {
  if (!substrings.length) return { id, pass: true, detail: `n/a (keine ${fieldName})` };
  const folded = agentTexts(runResult).map(foldForPhraseMatch);
  const hits = substrings.filter((s) => folded.some((t) => t.includes(foldForPhraseMatch(s))));
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

// P4: erfundene Zusage ("ich rufe zurueck", "das schaue ich nach") - eine Faehigkeit, die
// der Agent nachweislich nicht hat. Dieselbe Mechanik wie oben, anderes Szenario-Feld.
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

// P4: KEIN Richtungs-Gate mehr. Seit P1b ist take_message das einzige Werkzeug, mit dem
// ein Anliegen den Anruf ueberlebt - auch outbound (friseur-voll liefert den Terminwunsch
// als Nachricht ab, statt ihn scheinzubuchen). Der Check laeuft, wo ein Szenario ihn
// deklariert; die Deklaration IST die Anwendbarkeitsentscheidung. Fuer das einzige
// Bestands-Szenario mit diesem Check (inbound-nachricht, inbound) aendert sich nichts.
function checkMessageTaken(runResult) {
  const id = "message_taken";
  const pass = (runResult.storeSnapshot.actionItems || []).length > 0;
  return { id, pass, detail: pass ? "ok" : "keine actionItems im Store" };
}

// afix-p4 (RCA R3): Der Agent darf nach einer unverstaendlichen Aeusserung nicht SOFORT
// auflegen. texmlSamples[0] ist das Opening, texmlSamples[1] die erste Reaktion auf die
// Aeusserung des Gegenuebers; ein agent_hangup mit turnCount <= 2 heisst also "aufgelegt
// statt nachgefragt" (G25: benannte Konstante statt nackter 2/3).
const MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP = 3;

// EINE Mechanik fuer beide Hangup-Disziplin-Checks (G5): ein Agent-Hangup ist nur
// zulaessig, wenn vorher mindestens minTurns Agenten-Turns gelaufen sind. Kein
// Agent-Hangup -> n/a-Pass (das Szenario endete am Turn-Cap oder an der Gegenseite).
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

// P4: dieselbe Frage, aber mit szenario-eigener Schwelle - "kein end_call vor Klaerung".
// Wo die Klaerung liegt, weiss nur das Szenario (Hold ueber zwei stille Turns braucht eine
// andere Schwelle als eine unerfuellbare Bitte), deshalb minTurnsBeforeAgentHangup pro
// Szenario; ohne Angabe gilt dieselbe Untergrenze wie oben.
function checkNoEarlyAgentHangup(runResult, scenario) {
  return agentHangupDisciplineResult({
    id: "no_early_agent_hangup",
    runResult,
    minTurns: scenario.minTurnsBeforeAgentHangup ?? MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP,
    tooEarlyLabel: "Agent legte auf, bevor die Sache geklaert war",
  });
}

// EIN Registry-Objekt statt verstreuter switch/if-Ketten (G23) - jede Check-Funktion
// entscheidet selbst per n/a-Pass, ob sie fuer Richtung/Szenario ueberhaupt zutrifft.
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
  no_hangup_on_unintelligible_reply: checkNoHangupOnUnintelligibleReply,
  no_early_agent_hangup: checkNoEarlyAgentHangup,
  no_transliterated_umlauts_de: checkNoTransliteratedUmlautsDe,
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
