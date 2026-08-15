// ---- ElevenLabs-Anrufstart: der dritte Outbound-Weg ----------------------------------
// Neben TeXML und Telnyx-Call-Control fuehrt hier der Agent des ANBIETERS das Gespraech.
// Wir waehlen, wir sichern ab, wir buchen - aber wir sprechen nicht: es gibt auf diesem
// Weg weder Turn-Schleife noch Audio bei uns.
//
// WARUM KEIN PROVIDER-ADAPTER (src/telephony/adapters/*, Registry): der PROVIDER des
// Anrufs bleibt telnyx - die DID liegt dort, ElevenLabs haengt per SIP-Trunk daran. Ein
// zweiter Registry-Eintrag wuerde eine Anbieter-Wahl behaupten, die es nicht gibt (die
// Ports Signaturpruefung/SMS/Nummernkauf haetten hier kein Gegenstueck). Dies ist ein
// ENGINE-Zweig nach dem Muster von src/telnyx-origination.js.
//
// SICHERUNGEN (Absolute Regel 1): dieses Modul kennt KEIN einziges Gate und darf keins
// bekommen. Es waehlt erst, wenn die eine, unveraenderte Outbound-Gate-Kette in
// routes/api-calls.js den Anruf freigegeben hat - inklusive Kill-Switch, Verifikation
// (KYC/Abo), Kostendecke und dem Identitaets-Gate, das den Auftraggeber-Namen erzwingt
// (Traeger der Offenlegung, Artikel 50 EU AI Act). Eine zweite Formulierung derselben
// Regeln hier waere eine zweite, schwaechere Wahrheit.
//
// OFFENLEGUNG (Absolute Regel 2): der Satz ist first_message der AGENTEN-Konfiguration
// (elevenlabs/agent_configs/outbound-agent.template.json) und wird hier NICHT
// uebersteuert. Eine conversation_config_override wird vom Anbieter bei nicht
// freigeschaltetem Feld STILL ignoriert - der Satz duerfte nie daran haengen. Was unsere
// Seite liefert, ist der WERT, in den er faellt: owner_name - und der faellt NIE leer aus
// (s. dynamicVariables): eine gesetzliche Pflicht haengt nie an einer Variablen ohne
// Default.
//
// ERGEBNIS: ziehend. Der Anbieter meldet das Gespraechsende nicht an uns, wir holen es ab
// (GET /v1/convai/conversations/{id}, Takt ELEVENLABS_RESULT_POLL_MS) und legen Transkript
// und Zusammenfassung an denselben Call-Record, den get_transcript ohnehin liest.
import { DISCLOSURE_OWNER_FALLBACK_EN, LOCALES } from "../i18n/locales.js";
import { MS_PER_SECOND } from "../utils/timer.js";
import { endConversation, fetchConversation, startOutboundCall } from "./convai.js";
import { spokenTimezoneName } from "./nanp-area-codes.js";
import { callTimeContext } from "./time-context.js";

// Endzustaende des Anbieters. Alles andere gilt als LAUFEND und wird weiter abgeholt: ein
// unbekannter Status darf kein Gespraech vorzeitig fuer beendet erklaeren. Die Obergrenze
// der Abhol-Schleife ist der Max-Dauer-Cap des Aufrufers, nicht diese Liste.
const PROVIDER_DONE = "done";
const PROVIDER_FAILED = "failed";
const FINISHED_PROVIDER_STATUS = Object.freeze([PROVIDER_DONE, PROVIDER_FAILED]);

// Unsere Call-Endzustaende (store/state-ops.js) - bewusst benannt, weil "failed" auf
// beiden Seiten vorkommt und die beiden Vokabulare nicht dasselbe sind.
const CALL_COMPLETED = "completed";
const CALL_FAILED = "failed";

// KS-EL1 (Owner-Entscheidung, s. Modul-Kopf): der GRUND, wenn metadata.call_duration_secs
// beim Abgleich (answeredAnchorOutcome) weder 0 noch eine positive Zahl ist (fehlt, NaN,
// negativ, falscher Typ) - additiv am Call, s. store/state-ops.js recordAnsweredUnclearReason.
const ANSWERED_UNCLEAR_REASON = "call_duration_secs_unusable";

// Owner-Auftrag 15.08.2026 (cancel_call darf nicht luegen): der Beende-Versuch
// (convai.js#endConversation, DELETE) ist NICHT belegt, die Leitung beim Anbieter
// tatsaechlich zu kappen - der EINZIGE verlaessliche Deckel bleibt der ANBIETER SELBST:
// max_duration_seconds, besessen in elevenlabs/agent_configs/outbound-agent.template.json
// (live 600s seit 2026-08-15, s. dortiger _notbremse_hinweis). GENANNTER Wert statt
// gelesener Datei: die Vorlage bleibt in dieser Sitzung unangetastet (Auftragsgrenze) -
// dieser Wert BEWACHT sie, aendert sie nicht (Bewachung statt Korrektur, gleiches Muster
// wie prompt.timezone). Exportiert fuer die ehrliche cancel_call-Antwort (routes/
// api-calls.js), damit N dort KEINE Magic Number ist.
export const ELEVENLABS_PROVIDER_MAX_DURATION_S = 600;

// Rollen: der Anbieter kennt "agent" und "user", unser Transkript "agent" und "caller".
// Alles, was nicht der Agent ist, ist die Gegenstelle - ein unbekannter Rollenname darf
// keine Zeile verschlucken.
const AGENT_ROLE = "agent";
const CALLER_ROLE = "caller";

// Anbieter-Befund call_successful ("success" | "failure" | "unknown") auf unsere Achse.
// Alles Unbekannte -> "unclear", derselbe Sentinel wie im LLM-Weg (mcp-tools.js).
const OBJECTIVE_ACHIEVED_BY_PROVIDER = Object.freeze({ success: true, failure: false });
const OBJECTIVE_ACHIEVED_UNKNOWN = "unclear";

// Die Beschriftungen, mit denen Verbote und Hintergrund beim Agenten ankommen, kommen aus
// dem ENGLISCHEN Prompt-Baustein des Bestandswegs - derselbe, den src/claude.js ueber
// loc.prompt liest. Der Agent der Vorlage ist fest englisch (agent.language "en",
// first_message aus LOCALES.en), es gibt hier also keine Sprachwahl zu treffen. Ein zweiter,
// hier neu getippter Satz Beschriftungen waere eine zweite Wahrheit (G5).
const EN_PROMPT = LOCALES.en.prompt;

// Trennzeichen der Fakten-Liste - identisch zum Bestandsweg (src/claude.js,
// HINTERGRUND-Sektion), damit derselbe Kontext auf beiden Wegen gleich aussieht.
const KEY_FACT_SEPARATOR = "; ";

// Der Vorrang-Satz, woertlich aus dem Bestand. Dort haengt er als Anhaengsel an den
// Spielraum-Regeln und traegt darum ein fuehrendes Leerzeichen (src/claude.js:268); hier
// beginnt er eine eigene Zeile, deshalb getrimmt - der Wortlaut bleibt unangetastet.
const CONSTRAINTS_PRECEDENCE = EN_PROMPT.mandate.constraintsPrecedence.trim();

// Der Bestand setzt Beschriftung und Briefing mit EINEM Leerzeichen zusammen
// (src/claude.js assignmentBlock); die HINTERGRUND-Beschriftungen tragen ihren Abstand
// dagegen schon im Baustein. Deshalb hier einmal angeklebt statt in contextLine.
const BRIEFING_LABEL = `${EN_PROMPT.briefingLabel} `;

// Im Bestand stehen die GRENZEN als Aufzaehlung, auf diesem Weg steht die Buchungs-Grenze
// in Prosa - der Listenstrich faellt weg, der Satz bleibt unangetastet.
const LIST_DASH = /^-\s+/;

// Jeder Wert geht als getrimmter String raus, nie als undefined/null: fehlt dem Anbieter
// eine Variable, die seine Agenten-Vorlage referenziert, bricht er das Gespraech stumm ab
// (WebSocket-Close 1008), bevor ein Wort gesprochen ist. Zugleich DIE Leer-Pruefung der
// Bausteine unten: getrimmt wird VOR dem Ankleben einer Beschriftung, sonst ergibt ein
// blanker Wert genau die nackte Ueberschrift ("CONSTRAINTS:"), die es zu vermeiden gilt.
const alsText = (wert) => (typeof wert === "string" ? wert.trim() : "");

const roleOf = (role) => (role === AGENT_ROLE ? AGENT_ROLE : CALLER_ROLE);

const endStatusOf = (conversation) =>
  conversation.status === PROVIDER_DONE ? CALL_COMPLETED : CALL_FAILED;

const objectiveAchievedOf = (conversation) =>
  OBJECTIVE_ACHIEVED_BY_PROVIDER[conversation.analysis?.call_successful] ??
  OBJECTIVE_ACHIEVED_UNKNOWN;

// KS-EL1 (Owner-Entscheidung, s. Modul-Kopf): WAS aus dem Buchungsanker werden soll, reine
// Entscheidung OHNE Store-Mutation (P5/P6) - exportiert, weil sie ohne Store/Netz testbar
// ist. answeredAt traegt heute ZWEI Sachverhalte auf EINEM Feld: "die Verbindung steht"
// (markAnswered am Anrufstart, gelesen von isInCallConsult/mapStatus - bleibt UNVERAENDERT
// stehen) und "ab hier wird bezahlt" (voiceMinutesOf). Diese Funktion liefert den Wert fuer
// den ZWEITEN Sachverhalt, gezogen aus der Anbieter-Wahrheit metadata.call_duration_secs:
// der Wert ist 0, WAEHREND status=in-progress, und wird erst beim Uebergang auf
// processing/done befuellt (tasks/spike1-messung.jsonl:12).
//
// EHRLICHKEIT: OB dieser Wert ab der Rufannahme misst oder die Klingelphase (SIP-Ringing)
// einschliesst, ist NICHT belegt - der Anbieter dokumentiert die Zaehlgrenze nicht. Diese
// Ableitung geht darum vom GUENSTIGEREN Fall aus (Rufannahme bis Ende) - das ist eine
// ANNAHME, keine belegte Tatsache; ein echter Anruf mit bekannter Klingeldauer misst das
// demnaechst nach.
//
//   positiv (>0)        -> answeredAtIso = endedAt minus Dauer. voiceMinutesOf (billing/
//                           metering.js) rundet danach exakt ceil(Dauer/60) - die Minuten
//                           des Anbieters, OHNE dass diese Funktion voiceMinutesOf kennt
//                           oder anfasst.
//   0                    -> NIEMAND hat abgenommen: kein Anker, KEIN Grund - das ist
//                           bekannt, nicht unklar. Lieber eine Minute zu wenig als eine
//                           erfundene (der Kern dieser Aenderung).
//   fehlend/unbrauchbar  -> kein Anker, PLUS der Grund (ANSWERED_UNCLEAR_REASON): anders
//                           als bei 0 steht hier NICHT fest, ob abgenommen wurde.
export function answeredAnchorOutcome(endedAtIso, conversation) {
  const durationSecs = conversation?.metadata?.call_duration_secs;
  if (typeof durationSecs === "number" && Number.isFinite(durationSecs) && durationSecs > 0) {
    const answeredAtMs = Date.parse(endedAtIso) - durationSecs * MS_PER_SECOND;
    return { answeredAtIso: new Date(answeredAtMs).toISOString(), unclearReason: null };
  }
  return { answeredAtIso: null, unclearReason: durationSecs === 0 ? null : ANSWERED_UNCLEAR_REASON };
}

// Nur Zeilen mit gesprochenem Inhalt: der Anbieter fuehrt auch Werkzeug-Ereignisse im
// transcript, die kein message-Feld tragen.
const spokenLines = (conversation) =>
  (conversation.transcript || []).filter((zeile) => zeile && zeile.message);

// Die Buchungs-Grenze des Agenten - die WIRKUNG des Mandats, nicht sein Wortlaut. Der
// Bestand tauscht sie pro Anruf (src/claude.js:210: mandateScopeGiven ->
// boundaries.noBookingWithMandate, sonst boundaries.noBooking). Ein statischer
// Prompt-Satz kann das nicht: er sagte dem Agenten neben seinem Mandat die Regel des
// mandatlosen Falls zu ("nimm den Terminwunsch als Nachricht auf"), und welcher der
// beiden Saetze im Konflikt gewinnt, entschiede der Anruf. Sie reist deshalb IM WERT,
// wie Verbote und Hintergrund auch.
const bookingBoundary = (spielraumGegeben) =>
  (spielraumGegeben
    ? EN_PROMPT.boundaries.noBookingWithMandate
    : EN_PROMPT.boundaries.noBooking
  ).replace(LIST_DASH, "");

// Der Spielraum in den Worten des Auftraggebers, gefolgt von der Buchungs-Grenze, die er
// stellt. Die Enum-Achse on_out_of_scope hat auf diesem Weg noch keinen Platz (die Vorlage
// kennt genau EINEN {{mandate}}-Slot) - eine bewusste Luecke des Anrufstarts, kein
// Datenverlust: das Mandat bleibt vollstaendig am Call-Record.
//
// Die Weiche haengt am SPIELRAUM ALLEIN, nicht am Vorhandensein eines Mandats: eine blosse
// Ausweich-Reihenfolge ermaechtigt zu nichts (dieselbe Bedingung wie mandateScopeGiven,
// src/claude.js:97). Der Wert ist damit NIE leer - die Grenze gilt in beiden Lagen.
function mandateText(mandate) {
  const spielraum = alsText(mandate?.decide_freely);
  const rahmen = [spielraum, alsText(mandate?.fallback_order)].filter(Boolean).join(" ");
  const grenze = bookingBoundary(Boolean(spielraum));
  return rahmen ? `${rahmen}\n${grenze}` : grenze;
}

// Die harten Verbote - die OBERGRENZE des Mandats. Ohne sie wird aus "entscheide frei, aber
// hoechstens 40 Euro" am Anbieter "entscheide frei": kein halbes Mandat, sondern ein
// weitergehendes.
//
// Beschriftung, Vorrang-Satz UND der fuehrende Zeilenumbruch reisen MIT dem Wert und
// stehen NICHT im Prompt der Vorlage: der ist EIN statischer Text und kann keinen Block
// weglassen. Der Bestand laesst beides weg, sobald es keine Verbote gibt (src/claude.js:
// die constraints-Zeile in assignmentBlock und der Vorrang-Satz in mandateSection rendern
// nur bei gesetztem call.constraints) - statisch verspraeche der Prompt bei einem Auftrag
// ohne Verbote den Vorrang eines Textes, den es gar nicht gibt, und lud den Agenten ein,
// sich Grenzen auszudenken oder sein Mandat abzuschwaechen. Der Umbruch gehoert aus
// demselben Grund in den Wert (so loest es auch der Bestand, assistantContextSection):
// stuende er in der Vorlage, bliebe er als Leerzeile stehen, wenn der Wert wegfaellt.
function constraintsText(constraints) {
  const verbote = alsText(constraints);
  if (!verbote) return "";
  return `\n${EN_PROMPT.constraintsLabel} ${verbote}\n${CONSTRAINTS_PRECEDENCE}`;
}

// Der verdichtete Hintergrund des Auftrags. Aufbau, Reihenfolge, Beschriftungen und der
// Riegel am Ende sind die der HINTERGRUND-Sektion des Bestandswegs (src/claude.js
// assistantContextSection): jede Zeile rendert nur, wenn ihr Feld INHALT hat, und ohne eine
// einzige Zeile faellt der Block ganz weg - samt seines fuehrenden Umbruchs, der wie dort im
// Wert steckt. Der Riegel gehoert dazu - der Inhalt ist Information FUER den Agenten, keine
// Anweisung, die er weitergibt.
//
// Das Kanal-Gate (ASSISTANT_CONTEXT_ENABLED) wird hier NICHT ein zweites Mal formuliert: ist
// es zu, traegt der Call-Record gar keinen Kontext (routes/api-calls.js), und die
// Kontext-Zeilen fallen von selbst weg.
//
// Das BRIEFING steht als erste Zeile im selben Block - dieselbe Reihenfolge wie im Bestand
// (src/claude.js assignmentBlock: BRIEFING vor der HINTERGRUND-Sektion). Es faehrt bewusst
// im vorhandenen Wert mit statt als zehnte Variable: die Agenten-Vorlage muesste sonst um
// einen Platzhalter wachsen, den erst ein Push an den Anbieter wirksam macht. Es haengt
// NICHT am Kontext-Gate - Briefing und Kontext sind zwei Felder, und ein Block aus nur
// einem von beiden ist ein vollstaendiger Block.
function backgroundText({ context, briefing }) {
  const label = EN_PROMPT.background;
  const lines = [
    contextLine(BRIEFING_LABEL, briefing),
    contextLine(label.summary, context?.summary),
    contextLine(label.relationship, context?.recipient_relationship),
    contextLine(label.outcome, context?.desired_outcome),
    contextLine(label.facts, keyFactsText(context?.key_facts)),
  ].filter(Boolean);
  if (!lines.length) return "";
  return `\n${label.heading}\n${lines.join("\n")}\n${label.guardrail}`;
}

// Die Zone des ANGERUFENEN reist samt ihrem Satz und ihrem fuehrenden Zeilenumbruch -
// dasselbe Muster wie constraintsText/backgroundText und aus demselben Grund: der Prompt
// der Vorlage ist EIN statischer Text und kann keinen Block weglassen. Stuende der Satz
// statisch dort, verspraeche er bei einem nicht ableitbaren Land (jede +1-Nummer, s.
// time-context.js) eine Umrechnung gegen eine Zone, die niemand kennt.
//
// DREI LAGEN, DIE NICHT DASSELBE SIND (Eigentuemer-Entscheidung 2026-08-15) - genau EINE
// tritt je Anruf ein, der Wert ist deshalb NIE leer, und die frueher statisch im Prompt der
// Vorlage stehende Auffangzeile ist mit ihnen weggefallen (sie erlaubte weiterhin eine
// absolute Uhrzeit und waere neben Lage 3 eine zweite, schwaechere Wahrheit):
//   TATSACHE   die Zone steht ueber das LAND der Nummer fest (+33 -> Europe/Paris). Der
//              Agent rechnet um, ohne zu fragen.
//   HYPOTHESE  bei +1 gibt es kein Land, nur die Vorwahl. Die Zuordnung stimmt meistens,
//              aber nicht immer (Staaten ueber Zonengrenzen, Arizona ohne Sommerzeit), und
//              "meistens richtig" heisst bei Terminen: still falsche Uhrzeiten. Der Wert
//              reist deshalb als ANNAHME, und der Agent bestaetigt sie in EINEM Satz,
//              BEVOR er eine absolute Uhrzeit nennt - der Angerufene weiss seine Zone, das
//              ist die verlaesslichste Quelle, die es gibt, und sie kostet eine Sekunde.
//   KEINE      steht gar nichts fest, nennt der Agent GAR KEINE absolute Uhrzeit, spricht
//              unbestimmt ("tomorrow morning") und laesst die Gegenseite die Uhrzeit
//              nennen. Lieber unbestimmt als falsch - dieselbe Regel wie bei erfundenen
//              Zahlen.
// OFFEN als eigenes Paket, hier bewusst NICHT gebaut: den im Gespraech BESTAETIGTEN Wert
// speichern (zweite Haelfte der Eigentuemer-Entscheidung). Das braucht eine
// Ergebnis-Rueckmeldung des Agenten an uns und ein Feld am Store - beides gibt es auf
// diesem Weg noch nicht.
//
// Die Saetze sind hier getippt und stammen NICHT aus EN_PROMPT: der Bestandsweg hat kein
// Gegenstueck (dort steht die Uhrzeit fertig gerendert im Systemprompt, es gibt keinen
// Baustein dafuer). Ein neuer Eintrag in src/i18n/prompts/en.js waere ein Baustein ohne
// Leser im Bestand.
const calleeZoneFactSentence = (zone) =>
  `\nThe person you are calling is in the ${zone} time zone - convert every time you agree between those two zones and say which zone you mean.`;

// Der Bestaetigungssatz nennt die VERMUTETE Zone mit ihrem gesprochenen Namen. Ein fester
// Beispielname stuende bei jedem Anruf ausserhalb dieser einen Zone neben einer anderen
// Vermutung - der Agent liesse sich die falsche Zone bestaetigen und haette damit genau den
// Fehler eingesammelt, gegen den die Bestaetigung gebaut ist.
const calleeZoneHypothesisSentence = (zone) =>
  `\nThe person you are calling is probably in the ${zone} time zone. That is an assumption derived from their area code, it is not confirmed, and it may be wrong. Before you name any specific time, confirm it in one short sentence, for example: "I have you down as ${spokenTimezoneName(zone)} - is that right?" Once they have confirmed it, convert every time you agree between those two zones and say which zone you mean.`;

const CALLEE_ZONE_UNKNOWN_SENTENCE = `\nYou do not know which time zone the person you are calling is in, and you must not guess one. Never name an absolute time while the zone is unknown - no specific time, no clock time. Stay vague instead ("tomorrow morning") and let them name the exact time; then repeat it back together with the time zone they used.`;

function calleeTimezoneText({ calleeZone, calleeZoneHypothesis }) {
  if (calleeZone) return calleeZoneFactSentence(calleeZone);
  if (calleeZoneHypothesis) return calleeZoneHypothesisSentence(calleeZoneHypothesis);
  return CALLEE_ZONE_UNKNOWN_SENTENCE;
}

// Eine Kontext-Zeile - Beschriftung NUR bei Inhalt: ein blankes Feld ergaebe sonst eine
// Zeile, die aus nichts als ihrer Ueberschrift besteht ("- Desired outcome: ").
function contextLine(label, wert) {
  const text = alsText(wert);
  return text ? `${label}${text}` : "";
}

// Die Fakten-Liste als eine Zeile. Blanke Eintraege fallen raus, statt als leere Glieder
// zwischen den Trennzeichen zu stehen; bleibt nichts uebrig, entfaellt die Zeile ganz.
function keyFactsText(keyFacts) {
  if (!Array.isArray(keyFacts)) return "";
  return keyFacts.map(alsText).filter(Boolean).join(KEY_FACT_SEPARATOR);
}

// Fail-CLOSED: ein eingeschalteter Zweig ohne vollstaendige Kennungen waehlt NICHT. Ein
// stiller Rueckfall auf Telnyx waere die schlechtere Wahl - er verschleiert eine
// Fehlkonfiguration, die niemand bemerkt, solange die Anrufe irgendwie laufen. Der
// Aufrufer beendet den Call ueber seinen EINEN Fehlerpfad (Reserve frei, Tenant offen).
function assertConfigured(el) {
  const fehlend = [
    !el.apiKey && "ELEVENLABS_API_KEY",
    !el.agentId && "ELEVENLABS_AGENT_ID",
    !el.agentPhoneNumberId && "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  ].filter(Boolean);
  if (fehlend.length)
    throw new Error(
      `ElevenLabs-Anrufstart ist eingeschaltet, aber unvollstaendig konfiguriert: ${fehlend.join(", ")}`,
    );
}

// Der Auftrag reist als DYNAMISCHE VARIABLE. Es sind genau die neun, die die
// Agenten-Vorlage deklariert ({{owner_name}}, {{callee}}, {{objective}}, {{constraints}},
// {{background}}, {{mandate}}, {{owner_timezone}}, {{callee_timezone}}, {{today}}) -
// fehlt eine, bliebe ihr Platzhalter im Agenten-Prompt unaufgeloest. Der Weg ueber eine
// Prompt-Uebersteuerung scheidet aus: eine nicht freigeschaltete
// conversation_config_override wird vom Anbieter STILL ignoriert.
//
// owner_name ist der einzige mit INHALTLICHEM Default: er traegt die Offenlegung (Regel 2,
// Artikel 50 EU AI Act), und die haengt nie an einer Variablen ohne Default. Ein fehlender
// oder blanker Name ergaebe sonst den halben Satz "...on behalf of ." - das Identitaets-
// Gate davor (telephony/outbound-gates.js) prueft den WAHRHEITSWERT des Namens, ein Name
// aus lauter Leerzeichen passiert es. Die uebrigen tragen ohne Inhalt den leeren String:
// sie muessen DA sein, aber ihr Fehlen kostet keine Pflicht, sondern nur Inhalt. AUSSER
// {{mandate}}: dort haengt seit der Mandats-Weiche die Buchungs-Grenze mit drin, und die
// gilt in BEIDEN Lagen - der Wert ist deshalb nie leer (s. mandateText).
//
// AUSSPRACHE (Eigentuemer-Befund 15.08.2026, der Name klang falsch): der Name geht
// UNVERAENDERT raus - keine Lautschrift, keine Ersatz-Schreibweise an dieser Stelle. Wie er
// KLINGT, entscheidet ein Aussprache-Woerterbuch am Agenten (Zuordnungsfeld
// conversation_config.tts.pronunciation_dictionary_locators, besessen und begruendet in
// elevenlabs/agent_configs/outbound-agent.template.json, _aussprache_hinweis). Das ist die
// einzige Stelle, die traegt: den Namen spricht auch first_message - ein fertiger Text vor
// jedem Modell-Turn -, und was hier verfremdet wuerde, stuende genau so im Transkript und in
// der Offenlegung, deren Wortlaut wir nachweisen muessen.
//
// Die vier gebauten Bloecke gehen UNGETRIMMT raus: sie sind per Bau String (jeder Baustein
// liefert "" oder einen fertigen Block), sie haben ihre Eingaben bereits VOR der
// Leer-Pruefung getrimmt - und ihr fuehrender Zeilenumbruch ist Inhalt, den ein Trimmen
// hier wegfressen wuerde (dann stuende der Block ohne Leerzeile an der Auftragszeile).
//
// ZEIT (T7/T8): die Zone des Auftraggebers und das heutige Datum sind IMMER gesetzt (der
// Zeitkontext liefert beide fail-safe). Fuer die Gegenstelle geht IMMER ein Satz raus, aber
// nie ein blosser Bezeichner: er sagt zugleich, wie sicher der Wert ist - Tatsache,
// bestaetigungspflichtige Annahme oder gar keine Zone (s. calleeTimezoneText). Geraten wird
// dabei nichts (s. time-context.js). Vorher wirkte an dieser Stelle ein Festwert am Agenten
// ("Europe/Berlin"), der weder besessen noch pro Anruf richtig war.
function dynamicVariables({ call, ownerName, time }) {
  return {
    owner_name: alsText(ownerName) || DISCLOSURE_OWNER_FALLBACK_EN,
    callee: alsText(call.to),
    objective: alsText(call.goal),
    constraints: constraintsText(call.constraints),
    background: backgroundText({ context: call.context, briefing: call.briefing }),
    mandate: mandateText(call.mandate),
    owner_timezone: alsText(time.ownerZone),
    callee_timezone: calleeTimezoneText(time),
    today: alsText(time.today),
  };
}

/**
 * @param {{store: object, config: object, terminateAndBillCall: Function,
 *   billThunk: Function, finishCall: Function}} deps
 *   terminateAndBillCall/billThunk/finishCall = der EINE Terminierungspfad
 *   (telephony/call-termination.js) und die EINE callFinish-Instanz des Prozesses
 *   (INV-7) - der Ergebnisweg beendet Anrufe ueber denselben Gateway wie jeder andere
 *   Beender, nicht ueber einen zweiten, buchungsfreien Weg.
 */
export function makeElevenLabsOutbound({
  store,
  config,
  terminateAndBillCall,
  billThunk,
  finishCall,
}) {
  // Immer frisch gelesen (nicht beim Bauen eingefroren): Tests uebersteuern die Gruppe
  // zur Laufzeit, und der Abholtakt darf nicht an einer Kopie von vor dem Boot haengen.
  const settings = () => config.voice.elevenLabsOutbound;

  // Das Gespraech ist beim Anbieter zu Ende. Transkript, Zusammenfassung und Befund KOMMEN
  // VON IHM (wir haben auf diesem Weg weder Audio noch Turn-Schleife) und landen ueber die
  // Store-Mutatoren an denselben Feldern, die get_transcript ohnehin liest - kein zweiter
  // Schreibweg neben dem Store.
  function persistProviderResult(callId, conversation) {
    for (const zeile of spokenLines(conversation))
      store.addTranscript(callId, roleOf(zeile.role), zeile.message);
    store.recordProviderCallResult(callId, {
      summary: conversation.analysis?.transcript_summary || null,
      objectiveAchieved: objectiveAchievedOf(conversation),
    });
  }

  // Ergebnis persistieren, DANN terminalisieren, DANN den Anker nachziehen, ERST DANACH
  // buchen - so sieht die Buchungskette den fertigen Stand. hangUp bleibt null: es gibt
  // kein eigenes Provider-Leg mehr aufzulegen, das Gespraech ist beim Anbieter bereits
  // beendet.
  //
  // DER ANKER STEHT HIER, NICHT IM persistEnd-THUNK UNTEN: ohne eigenes hangUp (hangUp:
  // null) ruft terminateAndBillCall bill() synchron direkt nach persistEnd() - es gibt kein
  // Zeitfenster, in das sich ein Zwischenschritt haengen liesse. billThunk laedt den Call
  // FRISCH aus dem Store, der Anker muss also VOR dem Aufruf unten stehen. Der
  // endCallRecord-Aufruf hier liefert zugleich endedAt fuer answeredAnchorOutcome; der
  // zweite Aufruf im persistEnd-Thunk ist idempotent (setCallEndedAt greift nur aus
  // status==='active') und bleibt aus Symmetrie zu jedem anderen Terminierungspfad stehen.
  async function finishFromConversation(callId, conversation) {
    persistProviderResult(callId, conversation);
    const ended = store.endCallRecord(callId, endStatusOf(conversation));
    const anchor = answeredAnchorOutcome(ended?.endedAt, conversation);
    store.trueUpAnsweredAt(callId, anchor.answeredAtIso);
    if (anchor.unclearReason) store.recordAnsweredUnclearReason(callId, anchor.unclearReason);
    await terminateAndBillCall({
      persistEnd: () => store.endCallRecord(callId, endStatusOf(conversation)),
      hangUp: null,
      bill: billThunk(finishCall, store, callId),
      callId,
    });
  }

  function scheduleResultPoll(callId, conversationId) {
    setTimeout(() => void pollConversationResult(callId, conversationId), settings().resultPollMs);
  }

  // G5: der EINE fail-soft Ergebnisabruf, den sowohl der Poll-Takt (pollConversationResult)
  // als auch der Beende-Versuch (endActiveCall, s.u.) brauchen - EIN Fehlerpfad statt zwei
  // fast-identischer catch-Bloecke. Ein Abruffehler liefert null (weiter abholen bzw.
  // Persistenz ueberspringen): ein Schluckauf beim Anbieter darf weder ein laufendes
  // Gespraech fuer beendet erklaeren noch einen Beende-Versuch verhindern. Secret-frei
  // geloggt (err.message, nie Rumpf/Schluessel), mit der server-eigenen callId als
  // Korrelation.
  async function fetchConversationSoft(conversationId, callId) {
    return fetchConversation({ fetchImpl: fetch, account: settings(), conversationId }).catch(
      (err) => {
        console.error(`[el-outbound] Ergebnisabruf fehlgeschlagen (call=${callId}):`, err?.message);
        return null;
      },
    );
  }

  // Jeder Takt liest den Call FRISCH: ein zwischenzeitlich beendeter Anruf (Max-Dauer-Cap,
  // cancel_call) stoppt die Schleife, ohne dass jemand sie kuendigen muesste.
  async function pollConversationResult(callId, conversationId) {
    const call = store.getCall(callId);
    if (!call || call.status !== "active") return;
    const conversation = await fetchConversationSoft(conversationId, callId);
    if (!conversation || !FINISHED_PROVIDER_STATUS.includes(conversation.status))
      return scheduleResultPoll(callId, conversationId);
    await finishFromConversation(callId, conversation);
  }

  // TEIL A/Owner-Auftrag 15.08.2026 (Beende-Versuch beim Anbieter): der hangUp-Thunk des
  // EL-Pfades, eingespeist ueber telephony/call-termination.js#elevenLabsHangUpAction
  // (Aufrufer: der Max-Dauer-Cap UND cancel_call, DI statt Import-Kante telephony->
  // elevenlabs). REIHENFOLGE BINDEND (Kern des Auftrags): der Ergebnisabruf wird ZUERST
  // geholt und persistiert (Transkript + der Buchungsanker aus metadata.call_duration_secs,
  // dieselben Store-Mutatoren wie finishFromConversation), ERST DANACH kommt der
  // Loeschversuch (convai.js#endConversation) - ein DELETE nimmt beim Anbieter vermutlich
  // den kompletten Datensatz mit (Commit 08fc253), und was wir vorher nicht gesichert
  // haben, ist danach weg. endedAt liest FRISCH aus dem Store: der Aufrufer
  // (terminateAndBillCall) hat persistEnd() bereits ausgefuehrt, BEVOR hangUp() (und damit
  // diese Funktion) laeuft.
  //
  // FAIL-SOFT auf jeder Stufe (Absolute Regel 1): ein gescheiterter Ergebnisabruf
  // ueberspringt nur die Persistenz (fetchConversationSoft, s.o.) und haelt den
  // Loeschversuch NICHT auf - ein verpasster Datensatz ist kein Grund, den Versuch
  // aufzugeben. endConversation selbst wirft nie (s. convai.js).
  async function endActiveCall(callId) {
    const call = store.getCall(callId);
    const conversationId = call?.elevenlabsConversationId;
    if (!conversationId) return;
    const conversation = await fetchConversationSoft(conversationId, callId);
    if (conversation) {
      persistProviderResult(callId, conversation);
      const anchor = answeredAnchorOutcome(call.endedAt, conversation);
      store.trueUpAnsweredAt(callId, anchor.answeredAtIso);
      if (anchor.unclearReason) store.recordAnsweredUnclearReason(callId, anchor.unclearReason);
    }
    await endConversation({ fetchImpl: fetch, account: settings(), conversationId });
  }

  /**
   * Startet den Anruf beim Anbieter und haengt den ziehenden Ergebnisweg an. EIN Argument:
   * Ziel, Anliegen, Mandat und Mandant stehen bereits am Record (eine Quelle, kein zweiter
   * Satz Parameter, der davon abweichen koennte).
   *
   * WIRFT bei jedem Fehlschlag - der Aufrufer faehrt dann seinen EINEN Fehlerpfad
   * (terminateAndBillCall + Reserve-Freigabe). Die Kennung wird ERST NACH der Antwort des
   * Anbieters persistiert: ein gescheiterter Start hinterlaesst keine halbe Bindung, an
   * die sich spaeter ein fremder Rueckfrage-Webhook haengen koennte.
   */
  async function originateCall(call) {
    const el = settings();
    assertConfigured(el);
    const { ownerName } = store.tenantContext(call.tenantId);
    // Eigener Reader (store.tenantTimezone), NICHT tenantContext - genau wie im
    // Bestandsweg (src/claude.js): die Zeitzone gehoert nicht in die LLM-/MCP-View.
    const time = callTimeContext({
      tenantTimezone: store.tenantTimezone(call.tenantId),
      callee: call.to,
    });
    const conversationId = await startOutboundCall({
      fetchImpl: fetch,
      account: el,
      body: {
        agent_id: el.agentId,
        agent_phone_number_id: el.agentPhoneNumberId,
        to_number: call.to,
        conversation_initiation_client_data: {
          dynamic_variables: dynamicVariables({ call, ownerName, time }),
        },
      },
    });
    if (!conversationId) throw new Error("ElevenLabs-Anrufstart lieferte keine conversation_id");
    // AL-P1/EL-BL1: set-once am Record. Es ist dieselbe Kennung, ueber die der
    // Rueckfrage-Webhook (routes/webhooks-elevenlabs.js) den laufenden Anruf bindet.
    store.recordElevenlabsConversationId(call.id, conversationId);
    // DER BUCHUNGSANKER DIESES WEGES (Absolute Regel 1). Ohne ihn bleibt answeredAt leer,
    // voiceMinutesOf (billing/metering.js) liefert 0, reconcileVoiceBudget bricht ab - und
    // die pro-Tenant-Kostendecke saehe von diesem Zweig NICHTS: beliebig viele Anrufe, der
    // Zaehler steht still, und der Ausfall bleibt unsichtbar, weil jeder einzelne Anruf
    // gelingt. markAnswered ruft sonst nur routes/voice.js, und auf der SIP-Trunk-Strecke
    // des Anbieters kommt kein /voice-Webhook. Gebucht wird ueber DIESELBE Kette wie auf
    // jedem anderen Weg (terminateAndBillCall -> finishCall -> reconcileVoiceBudget); es
    // entsteht KEIN zweiter Kostenweg und kein zweites Gate.
    //
    // WARUM AN DIESER STELLE UND NICHT AM ERGEBNIS-ABRUF: der Anrufstart des Anbieters ist
    // BLOCKIEREND ueber die ganze Klingelphase und antwortet erst, wenn der SIP-INVITE
    // seine endgueltige Antwort hat (am 15.08.2026 gemessen, s. convai.js
    // REQUEST_TIMEOUT_MS: 40,3 s blosses Klingeln vor der Antwort) - der Zeitpunkt SEINER
    // Antwort ist die Rufannahme. Die Ist-Dauer aus dem Ergebnis-Abruf waere die genauere
    // Quelle, verlangte aber einen Setter mit EXPLIZITEM Zeitstempel; markAnswered stempelt
    // "jetzt" (set-once, store/state-ops.js). Die Abweichung ist der Verzug bis zu dem
    // Abhol-Takt, in dem das Ende auffaellt (ELEVENLABS_RESULT_POLL_MS, Default 5 s) - sie
    // bucht im Zweifel MEHR, nie weniger, und das ist an einem Gate die richtige Richtung.
    store.markAnswered(call.id);
    scheduleResultPoll(call.id, conversationId);
  }

  return { originateCall, endActiveCall };
}
