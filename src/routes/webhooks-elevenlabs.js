// ---- Werkzeug-Webhooks des ElevenLabs-Laufwerks (get_consult + look_up) --------------
// Seit Thema B (2026-08-19) traegt dieser Router ZWEI Werkzeug-Endpunkte derselben
// Bauart: den Rueckfrage-Webhook (get_consult, unten ausfuehrlich) und den
// Recherche-Webhook (look_up, s. handleLookup). Beide teilen Token, Bindung und
// Fehler-Netz; die Kopf-Begruendung unten gilt fuer beide.
// Der Agent des Anbieters fuehrt das Gespraech und ruft dieses Werkzeug MITTEN im
// laufenden, kostenden Anruf auf: er haelt seinen Request offen und legt unsere Antwort
// seinem Modell als Werkzeug-Ergebnis vor (Frage-Antwort-Zyklus, kein
// Feuern-und-Vergessen). Die Wirkung laeuft ueber den BESTEHENDEN Consult-Kanal
// (call.consults, AL-P13) - kein zweiter Rueckfrage-Weg neben dem, den
// await_call_event/answer_consult schon bedienen.
//
// AUTH-AUSNAHME (Absolute Regel 3, begruendet - Eintrag in src/route-policy.js):
// HANDLER-INTERNE AUTH. ElevenLabs ruft serverseitig und kann keinen Session-Cookie
// senden; es SIGNIERT Werkzeug-Webhooks auch nicht (es gibt nur frei konfigurierbare
// Request-Header, s. elevenlabs/agent_configs/outbound-agent.template.json). Die einzige
// Sicherung ist deshalb das geteilte Geheimnis im Header x-hermes-tool-token, timing-sicher
// (safeEqual) gegen ELEVENLABS_TOOL_TOKEN geprueft, BEVOR irgendetwas anderes geschieht -
// leerer config-Wert lehnt JEDEN Aufruf ab (fail-closed, nie offen). NICHT unter /voice
// gemountet: die Ed25519-Signaturpruefung des Providers gilt dort weiter unveraendert.
//
// REIHENFOLGE DER SICHERUNGEN ist bindend und steht im Handler noch einmal einzeln:
// Geheimnis -> Bindung an einen laufenden Anruf (und damit an seinen Mandanten) ->
// Faehigkeit -> Geld -> erst dann die Wirkung. Es gibt keinen "anfragenden Mandanten":
// der Webhook traegt ausser dem Plattform-Token keine Identitaet, der Mandant kann NUR aus
// dem gebundenen Anruf kommen.
import { Router } from "express";
import { blockingBudgetAxis } from "../budget-gate.js";
import { consultAllowedForCall } from "../consult/gate.js";
import { MAX_IN_CALL_CONSULTS_PER_CALL } from "../consult/in-call.js";
import { CONSULT_RESULT } from "../conversation/consult-raised.js";
import { localeFor } from "../i18n/locales.js";
import { bookLookupSearchFee } from "../llm-usage.js";
import { lookupFactsFrom, sanitizeLookupQuery } from "../research/lookup-guard.js";
import {
  LOOKUP_MAX_PER_CALL,
  elevenLabsLookupProviderFor,
} from "../research/registry.js";
import { consultQuotaUsed, elevenLabsLookupCount } from "../store/state-ops.js";
import { safeEqual } from "../util.js";

// Pfad + Header als benannte Konstanten (G25): beide stehen so in der Agenten-Vorlage.
export const ELEVENLABS_CONSULT_PATH = "/webhooks/elevenlabs/consult";
// Thema B (2026-08-19): der Recherche-Webhook (Werkzeug look_up) - GLEICHE Bauart wie
// der Rueckfrage-Webhook darueber, gleiche Domain, gleicher Token, gleiche Bindung.
export const ELEVENLABS_LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
// Thema B, Review-Befund B4: EIGENE Frist statt LOOKUP_TIMEOUT_MS (2500 ms) - deren
// Herleitung ist die Turn-Frist der BUDGET-Engine (turnLoopDeadlineMs 11500 ms), eine
// Groesse, die es auf diesem Weg nicht gibt (Lehre calibration-scope: eine Messung gilt
// nur fuer ihre Konfiguration). Bindend ist hier response_timeout_secs = 10 s am
// Werkzeug; 6000 ms lassen ~4 s Marge fuer Netz + Verarbeitung, statt 7,5 s bezahltes
// Budget verfallen zu lassen (die Gebuehr faellt VOR dem Absenden).
const EL_LOOKUP_TIMEOUT_MS = 6000;

// Die vier Ablehnungscodes. 402 nach dem Bestandsmuster der Geld-Denials
// (telephony/outbound-gates.js), 404 statt 403 nach dem Bestandsmuster der Call-Routen
// (kein Existenz-Leck), 403 fuer das Geheimnis, 400 fuer eine Nutzlast ohne brauchbaren
// Fragetext (s. Schritt 5 im Handler; Anbieter-Beleg dort zitiert).
// 500 ist keine Ablehnung, sondern das letzte Netz (s. Handler): ein unerwarteter Fehler
// MUSS beantwortet werden.
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

// Was das Laufwerk seinem Modell als Werkzeug-Ergebnis vorlegt. Alle drei Texte sind
// bestehende, sprachrichtige Steuertexte (i18n/prompts/*) - der Server erfindet hier keine
// neue Rede. Eine Antwort OHNE uebernommene Fakten (der geteilte key_facts-Deckel war voll)
// traegt denselben Text wie der Zeitablauf: es gibt nichts, was der Agent aussprechen
// koennte, und ein leerer Antworttext waere die schlechtere Luege.
function toolResultText(outcome, locale) {
  const control = locale.prompt.turnControl;
  if (outcome.kind === CONSULT_RESULT.REJECTED) return control.consultDeclined;
  return outcome.facts.length ? outcome.facts.join(" ") : control.consultTimeout;
}

// Bindung ueber die opake Anbieter-Kennung am Call-Datensatz - dasselbe Muster wie das
// bestehende Provider-Handle telnyxConversationId. NUR ein laufender Anruf ist bindbar:
// eine Wirkung nachtraeglich in ein beendetes Gespraech zu reichen ist derselbe Angriff
// wie eine erfundene Kennung. Kein Rueckfall auf "irgendeinen laufenden Anruf".
// MODUL-EBENE (G30, Muster elevenlabs/outbound.js): BEIDE Werkzeug-Webhooks binden ueber
// genau diese eine Funktion.
function activeCallBoundTo(store, conversationId) {
  if (typeof conversationId !== "string" || !conversationId) return null;
  const calls = store.load().calls;
  return (
    calls.find(
      (call) => call.elevenlabsConversationId === conversationId && call.status === "active",
    ) || null
  );
}

// ---- Thema B (2026-08-19): der Recherche-Webhook (Werkzeug look_up) ------------------
// GLEICHE Sicherungs-REIHENFOLGE wie handleConsult: Geheimnis -> Bindung -> Faehigkeit ->
// Geld -> Nutzlast -> Wirkung. Abweichungen, jede begruendet:
//   - Das KONTINGENT (Auflage B3, LOOKUP_MAX_PER_CALL) antwortet 200 mit einem
//     SPRECHBAREN Ablehnungstext statt 404: der Agent steht mitten im bezahlten
//     Gespraech, und ein Werkzeug-Fehler liesse ihn stocken - der Text laesst ihn
//     weiterreden (dasselbe Muster wie der Budget-Weg, research/in-call.js
//     performLookupRequest: declined ist ein Tool-ERGEBNIS, kein HTTP-Fehler).
//     "Nicht berechtigt" (Tor zu) bleibt dagegen 404 wie beim Consult (Auflage B1).
//   - Der EGRESS-Filter (sanitizeLookupQuery, dieselbe eine Quelle wie der Budget-Weg)
//     verwirft OHNE Gebuehr und OHNE Kontingent-Verbrauch.
//   - Gebuehr + Protokoll-Eintrag (Auflagen B5/B6) VOR dem Absenden: eine ausgeloeste
//     Suche ist bezahlt und protokolliert, auch wenn die Antwort nie ankommt. Das
//     PROTOKOLL traegt die Query (Owner-Auflage B5, fuer die Datenschutzerklaerung);
//     die KONSOLE bleibt PII-frei (Regel 4).
//   - "Nichts gefunden" und "zu langsam" (Timeout LOOKUP_TIMEOUT_MS) antworten beide
//     200 mit einem Weiterred-Text (Auflage B2): kein verwertbarer Fakt ist fuer den
//     Agenten in beiden Faellen dasselbe.
// MODUL-EBENE statt Factory-Closure (G30, haelt makeElevenLabsWebhookRoutes unter der
// Zeilengrenze - Muster elevenlabs/outbound.js); die Laufzeit-Instanzen reisen als EIN
// deps-Objekt (F1).
function lookupDenied(res, status, grund) {
  console.log(`[el-lookup] abgelehnt grund=${grund}`);
  return res.status(status).json({ error: grund });
}

function lookupAnswer(res, { callId, status, answer }) {
  console.log(`[el-lookup] call=${callId} ergebnis=${status}`);
  return res.json({ status, answer });
}

// Nutzlast-Form wie beim Consult (payloadQuestion, dort mit Anbieter-Beleg): der
// schema-deklarierte Parameter liegt FLACH auf oberster Ebene.
function lookupPayloadQuery(req) {
  const query = req.body?.query;
  if (typeof query !== "string" || !query.trim()) return null;
  return query;
}

// 6) Kontingent (Auflage B3): die naechste Anfrage nach dem Deckel wird abgelehnt, das
// Gespraech laeuft weiter - sprechbarer Text statt Werkzeug-Fehler (Kopf-Kommentar).
// 7) Egress-Filter: was den Server nicht verlassen darf, verlaesst ihn nicht - ohne
// Gebuehr, ohne Kontingent-Verbrauch (dieselbe eine Quelle wie der Budget-Weg).
// EIN Vorpruef-Schritt, weil beide dieselbe Antwortform teilen (G5) - liefert entweder
// die fertige declined-Antwort (done) oder die versandfertige Query (sanitized).
function preflightLookup({ call, query, control, res }) {
  const declined = () =>
    lookupAnswer(res, { callId: call.id, status: "declined", answer: control.lookUpDeclinedSpoken });
  if (elevenLabsLookupCount(call) >= LOOKUP_MAX_PER_CALL) {
    console.log(`[el-lookup] abgelehnt grund=kontingent call=${call.id}`);
    return { done: declined() };
  }
  const sanitized = sanitizeLookupQuery(query, call);
  if (!sanitized) {
    console.warn(`[el-lookup] verworfen grund=egress call=${call.id}`);
    return { done: declined() };
  }
  return { sanitized };
}

// Protokoll (B5) + Gebuehr (B6) VOR dem Absenden, dann die Suche, dann die Antwort ans
// Modell des Anbieters: Fakten als Text - oder der Weiterred-Text (B2). Beides 200.
async function executeLookup({ store, call, provider, query, control, res }) {
  const seq = store.recordCallLookup(call.id, query);
  bookLookupSearchFee({ tenantId: call.tenantId });
  const startedAt = Date.now();
  const result = await provider.searchFacts({ query, timeoutMs: EL_LOOKUP_TIMEOUT_MS });
  const facts = result.ok ? lookupFactsFrom(result.facts) : [];
  const dauerMs = Date.now() - startedAt;
  store.finishCallLookup(call.id, seq, {
    ok: result.ok === true,
    factCount: facts.length,
    dauerMs,
  });
  console.log(
    `[el-lookup] fertig call=${call.id} ok=${result.ok === true} dauer_ms=${dauerMs} fakten=${facts.length}`,
  );
  if (!facts.length) {
    return lookupAnswer(res, {
      callId: call.id,
      status: "no_results",
      answer: control.lookUpUnavailable,
    });
  }
  // Review-Befund B1 (Injektions-Riegel): die Treffer sind fremder Web-Text und gehen
  // NIE nackt an das sprechende Modell - der Rahmen (lookUpFactsFrame) markiert sie als
  // Daten, verbietet woertliches Vorlesen und Quellennennung. Dasselbe Prinzip wie die
  // Guardrail-Zeile des HINTERGRUND-Blocks auf dem Budget-Weg (claude.js).
  return lookupAnswer(res, {
    callId: call.id,
    status: "ok",
    answer: `${control.lookUpFactsFrame}${facts.join(" ")}`,
  });
}

async function handleLookup(req, res, { store, config }) {
  // 1) Geteiltes Geheimnis - identisch zu handleConsult (fail-closed, safeEqual).
  const secret = config.voice.elevenLabsToolToken;
  if (!secret || !safeEqual(req.get(TOOL_TOKEN_HEADER) || "", secret))
    return lookupDenied(res, HTTP_FORBIDDEN, "token");

  // 2) Bindung an einen LAUFENDEN Anruf und damit an den Mandanten.
  const call = activeCallBoundTo(store, req.body?.conversation_id);
  if (!call) return lookupDenied(res, HTTP_NOT_FOUND, "kein_laufender_anruf");

  // 3) Faehigkeit (Auflagen B1/B4): Richtung, Master-Schalter, Secret und das
  // Per-Tenant-Recht allowLookup - DIESELBE Torkette, die der Anrufstart fuer
  // {{lookup_available}} fragt (research/registry.js). 404 wie beim Consult.
  const provider = elevenLabsLookupProviderFor(call, store.resolveProfile);
  if (!provider) return lookupDenied(res, HTTP_NOT_FOUND, "kanal_nicht_freigegeben");

  // 4) Geld (Absolute Regel 1): die gerissene pro-Tenant-Decke sperrt auch diesen Weg.
  const budgetAxis = blockingBudgetAxis({ store, billing: config.billing, tenantId: call.tenantId });
  if (budgetAxis) return lookupDenied(res, HTTP_PAYMENT_REQUIRED, budgetAxis);

  // 5) Nutzlast.
  const query = lookupPayloadQuery(req);
  if (!query) return lookupDenied(res, HTTP_BAD_REQUEST, "keine_anfrage");

  const control = localeFor(call.language).prompt.turnControl;
  // 6+7) Kontingent und Egress (preflightLookup): beide antworten declined mit
  // sprechbarem Text (s. Kopf-Kommentar), beide OHNE Gebuehr und ohne Suchdienst.
  const preflight = preflightLookup({ call, query, control, res });
  if (preflight.done) return preflight.done;
  // INVARIANTE (Review-Hinweis): zwischen dieser Deckel-Pruefung und recordCallLookup
  // (erster Schritt von executeLookup) darf KEIN await liegen - sonst koennten zwei
  // gleichzeitige Aufrufe denselben freien Platz doppelt belegen.

  return executeLookup({ store, call, provider, query: preflight.sanitized, control, res });
}

/**
 * @param {{store: object, config: object, onConsultRaised: Function,
 *   consultSlots: {withOpenSlot: Function}}} deps
 *   onConsultRaised = die Wirkung am bestehenden Consult-Kanal
 *   (conversation/consult-raised.js), als Naht hereingereicht.
 *   consultSlots = die EINE ConsultDelivery-Instanz des Prozesses (consult/delivery.js).
 *   Ihre Slot-Zaehler begrenzen, wie viele Verbindungen gleichzeitig an EINEM Anruf bzw.
 *   EINEM Mandanten haengen duerfen - dieser Webhook ist ein solcher Halter.
 */
export function makeElevenLabsWebhookRoutes({ store, config, onConsultRaised, consultSlots }) {
  const router = Router();

  // Jede greifende Sicherung wird LAUT statt stumm (Diagnose-Muster des Brain-Shims):
  // ausschliesslich der Grund-Token und - wo vorhanden - die server-eigene Call-Kennung.
  // NIE die Nutzlast, nie ein Stueck des Geheimnisses (Absolute Regel 4).
  function denied(res, status, grund) {
    console.log(`[el-consult] abgelehnt grund=${grund}`);
    return res.status(status).json({ error: grund });
  }

  // Bindung: s. activeCallBoundTo (Modul-Ebene) - EINE Funktion fuer beide Webhooks.
  const activeCallByConversationId = (conversationId) => activeCallBoundTo(store, conversationId);

  // Faehigkeits-Schnittmenge des Kanals (consult/gate.js) PLUS das eigene Flag der
  // Rueckfrage IM Gespraech: diese Frage entsteht aus FREMDER Rede - der Angerufene hat
  // dem nie zugestimmt, und genau dafuer existiert IN_CALL_CONSULT_ENABLED getrennt vom
  // Kanal-Flag. Ohne diesen Faktor waere der neue Weg die Umgehung eines Datenschutz-Gates,
  // das der alte Weg respektiert.
  //
  // WARUM NICHT consultAvailableFor (consult/in-call.js) IM GANZEN: dieses Praedikat
  // fordert zusaetzlich callAnswered, consultClientIsPolling und "Engine != realtime".
  // Alle drei sind TURN-SCHLEIFEN-Fakten der Budget-Engine und an dieser Aufhaengung
  // strukturell falsch: das Gespraech fuehrt das ElevenLabs-Laufwerk (unsere Turn-Schleife
  // laeuft gar nicht, unser Abnehme-Zeitstempel und der Poll-Zeitstempel des Clients sagen
  // hier nichts ueber die Faehigkeit). Uebernommen werden deshalb GENAU die beiden
  // Faktoren, die keine Turn-Fakten sind - und zwar als Wiederverwendung ihrer Bausteine,
  // nicht als zweite Formulierung: die EINE Zahl MAX_IN_CALL_CONSULTS_PER_CALL und der
  // EINE Zaehler consultQuotaUsed (store/state-ops.js).
  //
  // RICHTUNG ist der Sicherheitskern (consult/in-call.js): die Rede eines fremden
  // Inbound-Anrufers darf NIE als "Rueckfrage" in den Kontext des Tenants exportiert
  // werden. KONTINGENT ist der Kosten-Riegel: jede angenommene Rueckfrage haelt das
  // kostende Gespraech bis CONSULT_OPEN_MS offen.
  //
  // calleeIsOwner ist AUS DEMSELBEN GRUND uebernommen und faellt nicht unter die
  // ausgelassenen Turn-Fakten: es ist eine Tatsache ueber das ZIEL dieses Anrufs, vor dem
  // Waehlen einmal entschieden und danach unveraenderlich am Datensatz (OC-P1) - keine
  // Aussage ueber unsere Turn-Schleife, die auf diesem Weg gar nicht laeuft. Der Anrufstart
  // rechnet mit DEMSELBEN Praedikat (consultAllowedForCall, consult/gate.js), und dass es
  // hier gefehlt hat, war der Defekt vom 06.09.2026: den eigenen Auftraggeber zu fragen,
  // waehrend man mit ihm telefoniert, kann niemand beantworten - die Leitung stand still,
  // bis CONSULT_OPEN_MS ablief.
  function consultAllowed(call) {
    return (
      config.tenancy.inCallConsultEnabled === true &&
      consultAllowedForCall(call, store.resolveProfile(call.tenantId)) &&
      call.direction === "outbound" &&
      consultQuotaUsed(call) < MAX_IN_CALL_CONSULTS_PER_CALL
    );
  }

  // Die Nutzlast des Anbieters ist FLACH: der schema-deklarierte Parameter question liegt
  // direkt auf oberster Ebene von req.body. GEMESSEN am Anbieter-Datensatz (tool_details.body)
  // eines echten Anrufs vom 18.08.2026 - Anruf call_msyexvu3q5r9, Anbieter-Gespraech
  // conv_3701m0a0fxnzen79mjd8qfcp6k00 - woertlich:
  //   {"question": "The workshop is asking for the car's make, model, and year for the brake
  //    inspection appointment - what should I tell them?"}
  // Mehr steht nicht drin: KEIN "parameters"-Umschlag. Die Umschlag-Form aus
  // agents/references/client-tools.md gilt hier NICHT - dieser Abschnitt beschreibt
  // CLIENT-Tools, wir betreiben ein WEBHOOK-Tool.
  //
  // Eigenstaendiges Praedikat statt inline: haelt handleConsult unter der Komplexitaets-
  // Grenze (G30, eine Aufgabe pro Funktion) und der Name macht die Absicht explizit (G20).
  // null heisst "keine brauchbare Frage" - fehlend, kein String oder nur Leerraum. Nie ein
  // stiller Rueckfall auf leeren Text (s. toolResultText: eine leere Frage waere eine Luege,
  // die dem Modell etwas zum Beantworten vorgaukelt). Kein Doppelweg ("question von hier ODER
  // aus parameters") - der wuerde genau den Fehler wieder verdecken, den diese Reparatur
  // behebt; die Umschlag-Form wird ab hier abgelehnt.
  function payloadQuestion(req) {
    const question = req.body?.question;
    if (typeof question !== "string" || !question.trim()) return null;
    return question;
  }

  async function handleConsult(req, res) {
    // 1) Geteiltes Geheimnis - VOR jedem Store-Zugriff, jeder Zustandsaenderung und jeder
    // Protokollzeile, die Inhalt tragen koennte. Leerer config-Wert -> 403 statt "nichts
    // zu pruefen" (Empty-Secret-Trap: safeEqual("", "") waere true).
    const secret = config.voice.elevenLabsToolToken;
    if (!secret || !safeEqual(req.get(TOOL_TOKEN_HEADER) || "", secret))
      return denied(res, HTTP_FORBIDDEN, "token");

    // 2) Bindung an Anruf und damit an den Mandanten.
    const call = activeCallByConversationId(req.body?.conversation_id);
    if (!call) return denied(res, HTTP_NOT_FOUND, "kein_laufender_anruf");

    // 3) Faehigkeit. Fehlt sie -> 404 wie an der /api-Kante: die Existenz des Kanals ist
    // selbst eine Information.
    if (!consultAllowed(call)) return denied(res, HTTP_NOT_FOUND, "kanal_nicht_freigegeben");

    // 4) Geld (Absolute Regel 1): die gerissene pro-Tenant-Decke sperrt AUCH diesen Weg -
    // eine Rueckfrage haelt das Gespraech offen und kostet damit Leitungsminuten.
    const budgetAxis = blockingBudgetAxis({
      store,
      billing: config.billing,
      tenantId: call.tenantId,
    });
    if (budgetAxis) return denied(res, HTTP_PAYMENT_REQUIRED, budgetAxis);

    // 5) Nutzlast-Form: question liegt flach auf oberster Ebene (voller Anbieter-Beleg an
    // payloadQuestion). Fehlt sie, ist das ein FEHLER, keine leere Frage.
    const question = payloadQuestion(req);
    if (!question) return denied(res, HTTP_BAD_REQUEST, "keine_frage");

    // 6) Gleichzeitigkeit - und erst DANN die Wirkung. Dieser Aufruf ist ein blockierender
    // Halter: er haelt die Verbindung des Anbieters bis CONSULT_OPEN_MS offen. Ohne
    // Obergrenze kann derselbe Anruf beliebig viele davon gleichzeitig aufziehen (gemessen:
    // 8 parallele Aufrufe, alle gehalten). Gezaehlt wird auf den BESTEHENDEN Slot-Zaehlern
    // des Kanals (MAX_OPEN_POLLS_PER_CALL / MAX_OPEN_POLLS_PER_TENANT, consult/delivery.js),
    // nicht auf einem zweiten daneben - "wie viele Verbindungen haengen an diesem Anruf"
    // ist EINE Tatsache. Kein freier Platz -> 404 wie jede andere Faehigkeits-Ablehnung,
    // OHNE dass ein Datensatz entsteht.
    const held = await consultSlots.withOpenSlot(call.id, call.tenantId, () =>
      onConsultRaised({ callId: call.id, question }),
    );
    if (!held.granted) return denied(res, HTTP_NOT_FOUND, "kein_freier_platz");
    const outcome = held.value;
    console.log(`[el-consult] call=${call.id} ergebnis=${outcome.kind}`);
    return res.json({
      status: outcome.kind,
      answer: toolResultText(outcome, localeFor(call.language)),
    });
  }

  // Eigenes Fehler-Netz statt des zentralen (app.js): Express 4 reicht die Rejection eines
  // async-Handlers NICHT an die Error-Middleware weiter - ohne dieses try/catch bliebe der
  // Aufruf des Anbieters bei einem Store-Fehler unbeantwortet haengen, bis dessen
  // response_timeout_secs zuschlaegt, und der Agent stuende stumm im laufenden Gespraech.
  // Die Antwort ist generisch (Regel 4/5): NIE err.message/stack an den Client, nie ein
  // Stueck der Nutzlast - die Diagnose bleibt server-seitig.
  router.post(ELEVENLABS_CONSULT_PATH, async (req, res) => {
    try {
      return await handleConsult(req, res);
    } catch (err) {
      console.error(`[el-consult] fehler: ${err?.stack || err?.message || "unbekannt"}`);
      if (res.headersSent) return res.end();
      return res.status(HTTP_SERVER_ERROR).json({ error: "intern" });
    }
  });

  // Dasselbe Fehler-Netz fuer den Recherche-Webhook (Begruendung oben).
  router.post(ELEVENLABS_LOOKUP_PATH, async (req, res) => {
    try {
      return await handleLookup(req, res, { store, config });
    } catch (err) {
      console.error(`[el-lookup] fehler: ${err?.stack || err?.message || "unbekannt"}`);
      if (res.headersSent) return res.end();
      return res.status(HTTP_SERVER_ERROR).json({ error: "intern" });
    }
  });

  return router;
}
