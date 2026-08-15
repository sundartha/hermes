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
import { fetchConversation, startOutboundCall } from "./convai.js";

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

// Nur Zeilen mit gesprochenem Inhalt: der Anbieter fuehrt auch Werkzeug-Ereignisse im
// transcript, die kein message-Feld tragen.
const spokenLines = (conversation) =>
  (conversation.transcript || []).filter((zeile) => zeile && zeile.message);

// Der Spielraum in den Worten des Auftraggebers. Die Enum-Achse on_out_of_scope hat auf
// diesem Weg noch keinen Platz (die Vorlage kennt genau EINEN {{mandate}}-Slot) - eine
// bewusste Luecke des Anrufstarts, kein Datenverlust: das Mandat bleibt vollstaendig am
// Call-Record.
function mandateText(mandate) {
  if (!mandate) return "";
  const teile = [mandate.decide_freely, mandate.fallback_order].map(alsText);
  return teile.filter(Boolean).join(" ");
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
// es zu, traegt der Call-Record gar keinen Kontext (routes/api-calls.js), und !context
// greift.
function backgroundText(context) {
  if (!context) return "";
  const label = EN_PROMPT.background;
  const lines = [
    contextLine(label.summary, context.summary),
    contextLine(label.relationship, context.recipient_relationship),
    contextLine(label.outcome, context.desired_outcome),
    contextLine(label.facts, keyFactsText(context.key_facts)),
  ].filter(Boolean);
  if (!lines.length) return "";
  return `\n${label.heading}\n${lines.join("\n")}\n${label.guardrail}`;
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

// Der Auftrag reist als DYNAMISCHE VARIABLE. Es sind genau die sechs, die die
// Agenten-Vorlage deklariert ({{owner_name}}, {{callee}}, {{objective}}, {{constraints}},
// {{background}}, {{mandate}}) - fehlt eine, bliebe ihr Platzhalter im Agenten-Prompt
// unaufgeloest. Der Weg ueber eine Prompt-Uebersteuerung scheidet aus: eine nicht
// freigeschaltete conversation_config_override wird vom Anbieter STILL ignoriert.
//
// owner_name ist der einzige mit INHALTLICHEM Default: er traegt die Offenlegung (Regel 2,
// Artikel 50 EU AI Act), und die haengt nie an einer Variablen ohne Default. Ein fehlender
// oder blanker Name ergaebe sonst den halben Satz "...on behalf of ." - das Identitaets-
// Gate davor (telephony/outbound-gates.js) prueft den WAHRHEITSWERT des Namens, ein Name
// aus lauter Leerzeichen passiert es. Die uebrigen fuenf tragen den leeren String: sie
// muessen DA sein, aber ihr Fehlen kostet keine Pflicht, sondern nur Inhalt.
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
// Die drei gebauten Bloecke gehen UNGETRIMMT raus: sie sind per Bau String (jeder Baustein
// liefert "" oder einen fertigen Block), sie haben ihre Eingaben bereits VOR der
// Leer-Pruefung getrimmt - und ihr fuehrender Zeilenumbruch ist Inhalt, den ein Trimmen
// hier wegfressen wuerde (dann stuende der Block ohne Leerzeile an der Auftragszeile).
function dynamicVariables(call, ownerName) {
  return {
    owner_name: alsText(ownerName) || DISCLOSURE_OWNER_FALLBACK_EN,
    callee: alsText(call.to),
    objective: alsText(call.goal),
    constraints: constraintsText(call.constraints),
    background: backgroundText(call.context),
    mandate: mandateText(call.mandate),
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

  // Ergebnis persistieren, DANN terminalisieren - so sieht die Buchungskette den fertigen
  // Stand. hangUp bleibt null: es gibt kein eigenes Provider-Leg mehr aufzulegen, das
  // Gespraech ist beim Anbieter bereits beendet.
  async function finishFromConversation(callId, conversation) {
    persistProviderResult(callId, conversation);
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

  // Jeder Takt liest den Call FRISCH: ein zwischenzeitlich beendeter Anruf (Max-Dauer-Cap,
  // cancel_call) stoppt die Schleife, ohne dass jemand sie kuendigen muesste. Ein
  // Abruffehler ist fail-SOFT (weiter abholen): ein Schluckauf beim Anbieter darf ein
  // laufendes Gespraech nicht fuer beendet erklaeren. Secret-frei geloggt (err.message,
  // nie Rumpf/Schluessel), mit der server-eigenen callId als Korrelation.
  async function pollConversationResult(callId, conversationId) {
    const call = store.getCall(callId);
    if (!call || call.status !== "active") return;
    const conversation = await fetchConversation({
      fetchImpl: fetch,
      account: settings(),
      conversationId,
    }).catch((err) => {
      console.error(`[el-outbound] Ergebnisabruf fehlgeschlagen (call=${callId}):`, err?.message);
      return null;
    });
    if (!conversation || !FINISHED_PROVIDER_STATUS.includes(conversation.status))
      return scheduleResultPoll(callId, conversationId);
    await finishFromConversation(callId, conversation);
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
    const conversationId = await startOutboundCall({
      fetchImpl: fetch,
      account: el,
      body: {
        agent_id: el.agentId,
        agent_phone_number_id: el.agentPhoneNumberId,
        to_number: call.to,
        conversation_initiation_client_data: {
          dynamic_variables: dynamicVariables(call, ownerName),
        },
      },
    });
    if (!conversationId) throw new Error("ElevenLabs-Anrufstart lieferte keine conversation_id");
    // AL-P1/EL-BL1: set-once am Record. Es ist dieselbe Kennung, ueber die der
    // Rueckfrage-Webhook (routes/webhooks-elevenlabs.js) den laufenden Anruf bindet.
    store.recordElevenlabsConversationId(call.id, conversationId);
    scheduleResultPoll(call.id, conversationId);
  }

  return { originateCall };
}
