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
// AL-D3: sprachinvariante Werkzeug-Namen, LOKAL statt importiert - src/consult/in-call.js
// und src/research/in-call.js ziehen beide config/store, checks.mjs bleibt laut eigenem
// Kopfkommentar rein und spawn-frei. EXPORTIERT, damit AL-D3-14
// (test/al-p8-bench-checks.test.js) sie gegen die echten Produkt-Exporte vergleichen kann -
// die Kopplung rottet damit nicht still.
export const GET_CONSULT_TOOL_NAME = "get_consult";
export const LOOK_UP_TOOL_NAME = "look_up";
// Phrasen-Fragment, das NUR in der Offenlegung vorkommt (disclosure-Bundle, alle
// Sprachen) - fuer den Inbound-Leak-Check reicht die deutsche Variante, da die Bench
// ausschliesslich mit language="de" seedet (siehe runner.mjs buildCallSeed).
const DISCLOSURE_LEAK_MARKER = "im Auftrag von";

function agentTexts(runResult) {
  return runResult.transcript.filter((t) => t.role === "agent").map((t) => t.text);
}

// Nur der FREI GENERIERTE Agententext (P4). agentSamples[0] ist die LLM-freie Eroeffnung
// - Offenlegung + Auftragssatz stammen aus dem Locale-Bundle bzw. dem Szenario-Goal und
// sagen nichts ueber die Schreibweise des MODELLS aus. Wuerde der Umlaut-Check sie
// mitlesen, naegelte er sich auf unsere eigene Fixture fest statt auf die Modell-Ausgabe.
// AL-P8: agentSamples (vormals texmlSamples) haelt EINEN Eintrag je Agenten-Turn,
// transportunabhaengig (TeXML- UND Shim-Treiber fuellen dieselbe Form).
const LLM_FREE_OPENING_SAMPLE_COUNT = 1;

function freeAgentTexts(runResult) {
  return runResult.agentSamples
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

// AL-P8: EINE Trefferquelle fuer alle Phrasen-Heuristiken (G5) - gefaltete Nadeln gegen
// gefaltete Texte. Die Aufrufer interpretieren den Trefferbestand unterschiedlich -
// Denylist (leer = gut), Recap (nicht leer = gut), handoff_rate (Anteil je Turn).
function foldedHits(texts, substrings) {
  const folded = texts.map(foldForPhraseMatch);
  return substrings.filter((s) => folded.some((t) => t.includes(foldForPhraseMatch(s))));
}

// Best-effort-Heuristik: NIEMALS zum Hard-Gate hochstufen - Overfitting-Risiko auf
// konkreten Wortlaut. Ein Treffer ist ein Befund fuer Judge/Owner, kein "Bench kaputt".
// EINE Implementierung fuer beide Phrasen-Checks (G5) - sie unterscheiden sich nur in
// Check-ID, Szenario-Feld und Befund-Text.
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

// AL-P8: EINE Quelle fuer die Roundtrip-Zahlen eines Laufs (G5) - genutzt vom
// Ausschoepfungs-Check UND von roundtrips_per_turn.
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

// AL-D3: EINE Quelle fuer die je Turn GEFEUERTEN Werkzeuge (G5, Muster turnRoundtrips):
// metrics.logTurn schreibt tools=firedTools, parseMetricsLog legt sie roh ab. Bis AL-D3
// hat kein Check dieses Signal gelesen - offeredToolNames gegen toolNames war genau der
// Befund D-3, und der Bench konnte ihn nicht sehen.
function turnFiredTools(runResult) {
  return runResult.metricsParsed
    .filter((m) => m.kind === "turn" && Array.isArray(m.payload.tools))
    .map((m) => m.payload.tools);
}

function toolFireCount(runResult, toolName) {
  return turnFiredTools(runResult).filter((tools) => tools.includes(toolName)).length;
}

// AL-D3: EINE Implementierung fuer alle vier Ja/Nein-Werkzeug-Checks (G5, Muster
// phraseDenylistResult/agentHangupDisciplineResult) - feuerte das benannte Werkzeug in
// mindestens einem Turn dieses Laufs, ja oder nein? value ist die Trefferzahl.
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

// P4: KEIN Richtungs-Gate mehr. Seit P1b ist take_message das einzige Werkzeug, mit dem
// ein Anliegen den Anruf ueberlebt - auch outbound (friseur-voll liefert den Terminwunsch
// als Nachricht ab, statt ihn scheinzubuchen). Der Check laeuft, wo ein Szenario ihn
// deklariert; die Deklaration IST die Anwendbarkeitsentscheidung. Fuer das einzige
// Bestands-Szenario mit diesem Check (inbound-nachricht, inbound) aendert sich nichts.
// EINE Zaehlquelle fuer beide Richtungen der Frage (G5).
function actionItemCount(runResult) {
  return (runResult.storeSnapshot.actionItems || []).length;
}

function checkMessageTaken(runResult) {
  const id = "message_taken";
  const pass = actionItemCount(runResult) > 0;
  return { id, pass, detail: pass ? "ok" : "keine actionItems im Store" };
}

// P6 (Mandat): Gegenstueck zu message_taken. Liegt das Angebot INNERHALB des vorab
// erteilten Mandats, ist take_message der Fehler - der Agent soll selbst zusagen. Die
// Deklaration im Szenario IST die Anwendbarkeitsentscheidung (Muster message_taken).
function checkNoMessageTaken(runResult) {
  const id = "no_message_taken";
  const n = actionItemCount(runResult);
  return { id, pass: n === 0, detail: n === 0 ? "ok" : `${n} actionItems trotz Mandat` };
}

// afix-p4 (RCA R3): Der Agent darf nach einer unverstaendlichen Aeusserung nicht SOFORT
// auflegen. agentSamples[0] ist das Opening, agentSamples[1] die erste Reaktion auf die
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

// ---- AL-P8: transportunabhaengige Messungen (Bench misst den Pfad, der live ist) ----
// Weitergabe-Phrasen fuer handoff_rate. Bewusst eine DENYLIST konkreter Wendungen
// (Muster DE_TRANSLITERATION_STEMS/mustNotPromiseSubstrings) - der Anteil der Agenten-
// Turns, in denen der Agent das Anliegen an den Besitzer zurueckgibt, statt selbst zu
// entscheiden. Deutsch, weil die Bench ausschliesslich language="de" seedet; jede andere
// Sprache -> n/a (dieselbe Grenze wie no_transliterated_umlauts_de).
const HANDOFF_PHRASES = Object.freeze([
  "gebe ich weiter", "gebe das weiter", "leite ich weiter", "gebe ich durch",
  "richte ich aus", "sage ich bescheid", "melde sich", "meldet sich dann",
  "muss ich rueckfragen", "muss ich nachfragen", "kann ich nicht entscheiden",
]);
const MULTI_QUESTION_MIN_MARKS = 2; // ab zwei "?" in EINEM Turn: mehr als eine Frage
const VALUE_ROUNDING = 1e4; // handoff_rate/roundtrips auf 4 Stellen (Muster round4 im runner)

// Die Checks, die in JEDEM Szenario laufen sollen (AL-P8): reine MESSUNGEN ohne
// Schwelle. Ihre Schwelle ist optional und szenario-lokal - ohne sie passen sie immer
// und liefern nur `value`. Genau diese Zahlen vergleichen AL-P5 (Eroeffnung), AL-P6
// (Turn-Budget) und AL-P9 (Briefing) per `compare` gegen die Baseline.
export const MEASUREMENT_CHECKS = Object.freeze([
  "opening_chars_before_yield", "handoff_rate", "one_question_per_turn", "roundtrips_per_turn",
]);

// AL-P5: Obergrenze fuer die LLM-freie Eroeffnung (agentSamples[0]) im Check
// opening_chars_before_yield - die Schwelle, die der AL-P8-Kommentar unten an AL-P5
// uebergeben hat. KEINE frei gewaehlte Zahl, sondern die laengstmoegliche deutsche
// Eroeffnung nach der Kuerzung: Offenlegung (129 Zeichen beim Bench-Owner
// "Jonas Beispiel") + Leerzeichen + Bruecke (22) + gekapptes Anliegen (75) + Punkt.
// Die Bench seedet ausschliesslich language="de" (s. expectedDisclosure oben).
// Gekoppelt an src/claude.js: test/al-p5-opening.test.js rechnet den Wert gegen das
// echte openingText nach - die Zahl kann nicht stumm rotten. AL-P5-Review-Runde 1 hat
// die Kappe von 70 auf 75 angehoben (s. OPENING_GOAL_MAX_CHARS-Kommentar in claude.js).
export const BENCH_MAX_OPENING_CHARS = 229;

// Die frei generierten Agenten-SAMPLES (ohne die LLM-freie Eroeffnung, Muster
// freeAgentTexts) - Grundlage fuer alle turn-weisen Messungen unten.
function freeAgentTurns(runResult) {
  return runResult.agentSamples.slice(LLM_FREE_OPENING_SAMPLE_COUNT);
}

// EIN Text je frei generiertem Agenten-Turn (sayTexts eines Turns zusammengefuegt) -
// im Unterschied zu freeAgentTexts (das die Turn-Grenze wegflacht) brauchen
// handoff_rate/one_question_per_turn/recap_present genau diese Turn-Granularitaet.
function freeAgentTurnTexts(runResult) {
  return freeAgentTurns(runResult).map((sample) => sample.sayTexts.join(" "));
}

// AL-D3 (R4): in jedem Turn, der look_up feuerte, muss gesprochener Text auf der
// Leitung gelegen haben - "nicht stumm", nicht mehr (Reichweiten-Grenze: der
// Shim-Treiber faltet ALLE SSE-Deltas eines Zuges zu einem sayTexts-Eintrag, ein Zug mit
// Text NACH der Suche ist von einem mit fuehrendem Satz an diesem Signal nicht
// unterscheidbar - siehe Bericht). Paart index-weise turnFiredTools <-> freeAgentTurnTexts
// (dieselbe Turn-Granularitaet, die LLM-freie Eroeffnung faellt in beiden weg). Weichen
// die Laengen ab, ist der Check ROT mit dem Befund - nicht still gruen.
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

// AL-P8: Zeichen, die der Agent spricht, BEVOR er das Wort abgibt (= Sample 0, die
// LLM-freie Eroeffnung). Transportunabhaengig: TeXML rendert sie als Say vor dem
// Gather, der Assistant-Pfad als Call-Control-speak vor ai_assistant_start. Schwelle
// optional (scenario.maxOpeningChars) - AL-P5 setzt sie, hier wird gemessen.
function checkOpeningCharsBeforeYield(runResult, scenario) {
  const id = "opening_chars_before_yield";
  const chars = (runResult.agentSamples[0]?.sayTexts || []).join(" ").length;
  const max = scenario.maxOpeningChars;
  if (max == null) return { id, pass: true, detail: `n/a (kein maxOpeningChars, ${chars} Zeichen)`, value: chars };
  return { id, pass: chars <= max, detail: `${chars}/${max} Zeichen`, value: chars };
}

// AL-P8: Anteil der frei generierten Agenten-Turns mit einer Weitergabe-Phrase.
// Best-effort-Heuristik, NIEMALS Hard-Gate (Muster phraseDenylistResult) - reine Messung.
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

// AL-P8: hat der Agent das Ergebnis am Ende zusammengefasst? Geprueft wird NUR der
// LETZTE frei generierte Turn - eine Wiederholung mittendrin ist kein Recap. Die
// Deklaration (scenario.recapSubstrings) IST die Anwendbarkeitsentscheidung (Muster
// message_taken).
function checkRecapPresent(runResult, scenario) {
  const id = "recap_present";
  const substrings = scenario.recapSubstrings || [];
  if (!substrings.length) return { id, pass: true, detail: "n/a (keine recapSubstrings)", value: null };
  const last = freeAgentTurnTexts(runResult).at(-1) || "";
  const present = foldedHits([last], substrings).length > 0;
  return { id, pass: present, detail: present ? "ok" : "kein Recap im letzten Agenten-Turn", value: present };
}

// AL-P12: hat der Agent einen Fakt aus einem FRUEHEREN Anruf genannt, den er nur aus dem
// Beziehungsgedaechtnis haben kann? Deklarativ ueber scenario.expectedMemoryPhrases
// (Muster recapSubstrings/mustNotPromiseSubstrings); geprueft ueber ALLE frei generierten
// Turns, gefaltet (foldedHits, G5).
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

// AL-P8: Turns, in denen der Agent mehr als eine Frage stellt (>= 2 Fragezeichen).
// Deterministisch und sprachunabhaengig - keine Phrasenliste. Schwelle optional
// (scenario.maxMultiQuestionTurns) - ohne sie ist es eine reine Messung.
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

// AL-P8 (Quelle: AL-P1): mittlere llm.complete-Roundtrips je agentTurn aus den
// metrics-turn-Zeilen. Ohne turn-Zeilen (METRICS_ENABLED aus) -> n/a, value null.
function checkRoundtripsPerTurn(runResult) {
  const id = "roundtrips_per_turn";
  const values = turnRoundtrips(runResult);
  if (!values.length) return { id, pass: true, detail: "n/a (keine turn-Metriken)", value: null };
  const mean = Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * VALUE_ROUNDING) / VALUE_ROUNDING;
  return { id, pass: true, detail: `Mittelwert ${mean} ueber ${values.length} Turns`, value: mean };
}

// AL-P11: Mindest-Trefferquote der Ergebnis-Karte (Plan Phase 11: >= 80 % ueber 5 Repeats).
const RESULT_SLOT_MIN_HIT_RATE = 0.8;

// Alle Freitext-Felder der Ergebnis-Karte zu EINEM Suchtext zusammengefasst - in welchem
// Feld ein Wert landet, ist Modell-Ermessen, DASS er in der Karte steht, nicht.
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

// AL-P11: Traegt die Ergebnis-Karte die Angaben, die im Gespraech gefallen sind?
// Deklarativ ueber scenario.expectedResult ([{slot, any:[...]}]) - die Deklaration IST
// die Anwendbarkeitsentscheidung (Muster message_taken/recap_present). Gesucht wird ueber
// die GESAMTE Karte (outcome + Listen + next_step), gefaltet (foldForPhraseMatch, G5):
// in welchem Feld ein Wert landet, ist Modell-Ermessen, DASS er in der Karte steht, nicht.
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
  // AL-D3: die vier Regel-Checks (R1/R2/R3) + der Ruhe-Check (R4).
  consult_fired: checkConsultFired,
  no_consult_fired: checkNoConsultFired,
  lookup_fired: checkLookupFired,
  no_lookup_fired: checkNoLookupFired,
  lookup_turn_not_silent: checkLookupTurnNotSilent,
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
