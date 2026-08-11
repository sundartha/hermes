// WW-F2 (tasks/PLAN-WERKZEUGWAHL.md, Wurzel W3): das NACHFASSEN - aus einer
// ANGEKUENDIGTEN Handlung eine AUSGEFUEHRTE machen.
//
// BEFUND, am echten Anbieter gemessen (deepseek-v4-pro, n=5 je Arm, alle Arme
// byte-identisch bis auf EINE Variable):
//   tool_choice=auto (Live-Zustand): get_consult 0/5, take_message 0/5, KEIN WERKZEUG 5/5
//   tool_choice=required:            get_consult 5/5, mit fachlich richtigen Fragen
//   Reihenfolge der Werkzeuge getauscht: unveraendert 0/5 (NICHT die Wurzel)
//   take_message entfernt:            nur 1/5 (Ueberlappung NICHT die Hauptwurzel)
// Das Modell ERZAEHLT die Handlung, statt sie auszufuehren ("Ich wuerde das gerne an
// Jonas weitergeben"). Unter Zwang waehlt es zuverlaessig das richtige Werkzeug. Die
// FAEHIGKEIT ist da, die AUSLOESUNG fehlt - genau diese Luecke schliesst GENAU EIN
// erzwungener Nachfass-Zug.
//
// WARUM EIN TEXT-SIGNAL UND KEIN SPRACHFREIES (Bedingung B4, ausdrueckliche Begruendung):
// die Ankuendigung EXISTIERT nur im natuerlichsprachlichen Text der Runde - es gibt keinen
// zweiten Traeger. Das einzige sprachfreie Signal waere "Runde ohne Werkzeugaufruf"; das
// trifft die grosse Mehrheit aller Zuege (Begruessung, Sachantwort, Rueckfrage der
// Gegenstelle) und loeste in jedem davon einen zweiten Modellaufruf UND einen erzwungenen
// Werkzeugaufruf aus - die Ueberkorrektur aus B3 und der Latenzaufschlag aus B1 in einem.
// Gelesen wird deshalb der Text, aber in ALLEN DREI Produktsprachen und aus den
// bestehenden Sprach-Bausteinen (i18n/prompts/de|en|fr.js), nicht aus einer deutschen
// Liste im Code. Eine Sprache ohne Marker faellt auf das heutige Verhalten zurueck
// (fail-closed, B5) - sie schweigt nie, sie fasst nur nicht nach.
//
// Rein (N7): kein Store, kein config, kein IO. Alle Schalter kommen als Argument, damit
// die Entscheidung an EINER Stelle vollstaendig pinnbar ist.
import { localeFor } from "./i18n/locales.js";
import { LLM_TOOL_CHOICE, forcedTool } from "./llm/tool-choice.js";

// Vergleichsform der Marker-Suche. Deutsche Transliteration (ae/oe/ue/ss) und
// franzoesische Akzente sind die zwei Stellen, an denen derselbe Wortstamm zwei
// Schreibweisen hat - beide Seiten werden auf EINE gebracht. Ohne das haenge der Treffer
// daran, ob das Modell "Ruecksprache" oder "Rücksprache" schreibt (Lehre
// umlaut-transliteration-root-cause: beide Schreibweisen kommen live vor).
// NFC zuerst, damit ein zerlegt geliefertes "a + Trema" denselben Weg nimmt wie "ä";
// NFD zuletzt, damit die uebrigen diakritischen Zeichen (é, è, à) fallen.
const UMLAUT_EXPANSIONS = Object.freeze([
  ["ä", "ae"],
  ["ö", "oe"],
  ["ü", "ue"],
  ["ß", "ss"],
]);
const COMBINING_MARKS = /\p{M}+/gu;

function comparableText(text) {
  let out = text.normalize("NFC").toLowerCase();
  for (const [from, to] of UMLAUT_EXPANSIONS) out = out.split(from).join(to);
  return out.normalize("NFD").replace(COMBINING_MARKS, "");
}

// Trifft einer dieser Marker den Text? EIN Marker ist eine Liste von TEILEN, die ALLE
// vorkommen muessen (i18n/prompts/de.js followUp): das deutsche trennbare Verb reisst
// sonst auseinander ("Ich gebe das an Jonas weiter") und bliebe unerkannt.
function matchesAnyMarker(text, markers) {
  if (!text) return false;
  const haystack = comparableText(text);
  return markers.some((parts) => parts.every((part) => haystack.includes(comparableText(part))));
}

// Kuendigt dieser Modelltext eine Handlung an, die eines unserer Werkzeuge ausfuehrt?
// Gelesen wird die VEREINIGUNG beider Marker-Klassen - die WW-F4-Partition der
// Sprachdateien aendert an dieser Frage nichts, sie beantwortet nur die zweite (welches
// Werkzeug erzwungen wird).
// Exportiert, weil die Erkennung der eigentliche Gegenstand dieser Phase ist und je
// Sprache direkt pinnbar sein muss (dieselbe Begruendung wie isSideEffectOnlyTool).
export function announcesToolAction(text, language) {
  const followUp = localeFor(language).prompt.followUp;
  return matchesAnyMarker(text, [...followUp.consultMarkers, ...followUp.messageMarkers]);
}

// WW-F4: Kuendigt der Text eine Handlung an, die auf eine ENTSCHEIDUNG des Auftraggebers
// hinauslaeuft (Ruecksprache, nachfragen, abstimmen)? Echte Teilmenge von
// announcesToolAction - eine angekuendigte NACHRICHT liefert hier false.
export function announcesConsultAction(text, language) {
  return matchesAnyMarker(text, localeFor(language).prompt.followUp.consultMarkers);
}

// Der Werkzeugsatz des Nachfass-Zuges - oder null, wenn NICHT nachgefasst wird. Die EINE
// Stelle, an der alle Bedingungen zusammenkommen; jede einzelne ist fail-closed, jede
// liefert im Zweifel null (= Bestandsverhalten, B5):
//   enabled       - der Schalter. AUS heisst byte-identischer Draht (B1).
//   alreadyUsed   - die harte Obergrenze aus B2: HOECHSTENS EIN Nachfassen je Zug. Der
//                   Nachfass-Zug selbst kann sich damit nie erneut ausloesen, auch wenn er
//                   wieder nur Text liefert - eine Endlosschleife am offenen Telefon ist
//                   strukturell ausgeschlossen, nicht per Prompt.
//   candidateTools- die Werkzeuge, die im Nachfass-Zug waehlbar sind. Der Aufrufer nimmt
//                   end_call heraus (B6); ein leerer Satz heisst "nichts zu erzwingen".
//   Ankuendigung  - das Sprachsignal (B3: ohne Ankuendigung kein Nachfassen).
export function followUpToolsFor({ enabled, alreadyUsed, text, language, candidateTools }) {
  if (!enabled) return null;
  if (alreadyUsed) return null;
  if (!candidateTools.length) return null;
  if (!announcesToolAction(text, language)) return null;
  return candidateTools;
}

// WW-F4: die WERKZEUGWAHL des Nachfass-Zuges - Sammel-Zwang oder benannter Zwang?
//
// BEFUND (tasks/werkzeugwahl-fix2-messung.md 3.4): in einer FRISCHEN Runde waehlt das
// Modell unter Zwang 5/5 get_consult. Im Nachfass-Zug ist die Runde aber NICHT frisch -
// die eigene Aeusserung der Vorrunde steht als providerTurnMessage mit in der Kette, und
// unter dem Sammel-Zwang (required) holt das Modell genau die Handlung ab, die es selbst
// angekuendigt hat. Im einzigen live gemessenen Eingriff war das take_message, obwohl
// eine Entscheidung des Auftraggebers anstand: das Nachfassen ERBTE die Absicht, statt
// sie zu korrigieren. Der benannte Zwang bricht genau diese Vererbung.
//
// Fail-closed in jeder anderen Lage - der Bestand ist immer der Rueckfallwert:
//   - get_consult nicht im Zug (Kontingent, Poll, Recht, Inbound) -> required wie heute
//   - Ankuendigung einer NACHRICHT -> required wie heute. Eine legitime Nachricht wird
//     NIE in eine Rueckfrage umgebogen; das waere die Ueberkorrektur, die diese Kette
//     ausdruecklich vermeidet.
// Traegt ein Text BEIDE Klassen ("Ich frage bei Jonas nach und gebe Ihnen Bescheid"),
// gewinnt die Rueckfrage: die offene Frage ist der Teil, der sonst verloren geht - die
// Nachricht kann der Agent danach immer noch aufnehmen.
//
// end_call kann hier strukturell nie herauskommen: benannt wird ausschliesslich das
// Rueckfrage-Werkzeug, und der Sammel-Zwang laeuft ueber candidateTools, aus denen der
// Aufrufer end_call bereits entfernt hat (B6).
//
// consultToolName kommt als ARGUMENT (wie alle Schalter dieser Datei): der Name lebt in
// consult/in-call.js, das config und store importiert - ein Import von dort machte dieses
// reine Modul von beidem abhaengig und braeche den direkten Import im Test.
export function followUpToolChoiceFor({ text, language, candidateTools, consultToolName }) {
  const consultOffered = candidateTools.some((tool) => tool.name === consultToolName);
  if (!consultOffered) return LLM_TOOL_CHOICE.REQUIRED;
  if (!announcesConsultAction(text, language)) return LLM_TOOL_CHOICE.REQUIRED;
  return forcedTool(consultToolName);
}
