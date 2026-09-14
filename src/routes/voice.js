// ---- makeVoiceRoutes (Server-Slim P11) --------------------------------------------
// Extrahierte Voice-Webhook-Gruppe (GET /voice/tts/:token, die /voice-Signatur-MW,
// POST /voice/incoming|turn|outbound|status) als Factory mit Dependency-
// Injection - gleiches Muster wie makeCallRoutes/makeReadRoutes. Teil der
// server.js-Decomposition (PLAN-SERVER-SLIM P11): REINE Verschiebung, Verhalten
// unveraendert (byte-identische Pfade/Status/Bodies/Audit-Events). G5-1-Dedup
// (attachOrHangup) ist ausdruecklich Folgearbeit, NICHT diese Phase. HOECHSTES
// EINZEL-RISIKO der server.js-Decomposition: hier leben die Safety-Gates fuer
// Provider-Signatur (Regel 3) und die Offenlegungs-Textpfade (Regel 2).
//
// Import-vs-Inject wie api-calls.js (P9): reine Modul-Konstanten/Praedikate/Formatierer
// mit EINER kanonischen Heimat (normNum/DEFAULT_PROVIDER, sayD/hangupD, SPEAK_OUTCOME,
// localeFor, callFailureReason, degradedSpeechFor, agentTurn/openingText/callerHasSpoken,
// remainingMaxDurationMs, noSpeechEscalation, metrics, logInboundPath/INBOUND_PATH,
// legRunsOurTurnLoop) werden direkt importiert (G5 "eine Quelle"). Laufzeit-Instanzen
// (voiceRender/directiveSynth/ttsStore/lifecycle/finishCall, INV-7), der
// Provider-Dispatch-Seam (webhookEvents/providerFromHeaders/
// inboundSignatureVerifier, DIP) sowie der Settlement-Seam (terminateAndBillCall/
// billThunk) und config/store/audit werden injiziert (INV-7 "eine Instanz").
import { Router } from "express";
import { normNum, DEFAULT_PROVIDER, MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
import { emergencyBrakeSeconds } from "../call-duration.js";
import { callTariffCentsPerMin } from "../billing/metering.js";
import { say as sayD, hangup as hangupD } from "../telephony/directives.js";
import { SPEAK_OUTCOME } from "../telephony/adapters/telnyx/speak-events.js";
import { localeFor } from "../i18n/locales.js";
import { withInboundNotice } from "../i18n/inbound-notice.js";
import { greetingForLanguage } from "../i18n/greeting-catalog.js";
import { callFailureReason } from "../telephony/failure-reason.js";
import { degradedSpeechFor } from "../llm.js";
import { noteLlmBillingOutage } from "../llm-billing-outage.js";
import { agentTurn, openingText, callerHasSpoken } from "../claude.js";
import { isBudgetAxis } from "../budget-gate.js";
import { remainingMaxDurationMs } from "../store/state-ops.js";
import { noSpeechEscalation } from "../no-speech-escalation.js";
import { metrics } from "../metrics.js";
import { logInboundPath, INBOUND_PATH } from "../telephony/inbound-path.js";
import { ANSWERED_BY } from "../telephony/answered-by.js";
import { persistEndWithReason } from "../telephony/call-termination.js";
import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { makeWebhookIdempotenz } from "../telephony/webhook-idempotenz.js";
import { legRunsOurTurnLoop } from "../telephony/leg-turn-loop.js";

// normNum (E.164-Normalisierung) lebt zentral in store/defaults.js (EINE Quelle,
// geteilt mit Seed + Profil-Allowlist) und wird oben importiert.

// Webhook-Parsing (Speech-Ergebnis/Lifecycle-Status/Speak-Outcome) lebt hinter dem
// WebhookEvents-Port (Port 5): webhookEvents(provider) aus telephony/registry.js,
// Implementierung je Provider in telephony/adapters/<provider>/webhook-events.js.

// ---- Eingabe-Validierung fuer API-Routen ----
// E164, TEXT_LIMITS, invalidText: extrahiert nach src/routes/_validation.js (T4 Phase 2).

// Gesprochene Degradations-/Reprompt-Texte fuer den /voice/turn-Fehlerpfad leben seit
// F1 P4 sprachabhaengig im Locale-Bundle (i18n/locales.js, eine Quelle pro Sprache):
//   llmDegradedSpeech  - wuerdevolles Ende bei anhaltender LLM-Nichtverfuegbarkeit
//                        (LlmUnavailableError aus dem resilienten Seam)
//   turnErrorSpeech    - generisches technisches Ende fuer jeden anderen Fehler
//   noSpeechReprompt   - knappe Rueckfrage, wenn der Gather leer lief (G4)
// Der Aufrufer hat call -> localeFor(call.language).<feld>. DE-Werte tragen seit P1
// korrekte Umlaute (i18n-Test + de-umlaut-orthography pinnen sie).

// IE4: die Ersatzantwort auf eine WIEDERHOLTE Zustellung - leere Direktivenliste, damit
// der Provider das laufende Dokument des uebergebenen Beins nicht zurueksetzt.
// Leere Liste mit EINER Frage: "den laufenden Dokumentfluss eines uebergebenen Beins nicht anfassen".
const RUNNING_DOCUMENT_UNTOUCHED = [];

// IE4: die Antwort richtet sich nach dem ZUSTAND des Beins, nicht nach der Engine.
// Budget-Bein (und jeder unbelegte Zustand) -> unveraenderter Folge-Gather OHNE Prompt:
// Mikrofon offen, keine Modellrunde, keine Synthese. Uebergebenes Bein (heute der
// Realtime-Stream, ab IE5 die SIP-Uebergabe) -> gueltiges, aber leeres Dokument.
// MODUL-EBENE statt im Abschluss von makeVoiceRoutes (Praezedenz
// recordStartRejectionReason in api-calls.js): die Entscheidung braucht keinen
// Server-Zustand, nur die Direktiven-Fabrik - und makeVoiceRoutes traegt bereits zu viel.
function repeatDeliveryXml(call, { render, followupTurnDirectives }) {
  const directives = legRunsOurTurnLoop(call)
    ? followupTurnDirectives(call, "")
    : RUNNING_DOCUMENT_UNTOUCHED;
  return render(directives, call.provider);
}

// FW2: EIN Kanalname fuer die Diagnose-Zeilen dieses Webhooks (G25).
const TURN_LOG_PREFIX = "[voice/turn]";

// IE7: die EINE Antwort der TTS-Route auf "gibt es nicht (mehr)" - Nichtfund UND
// Fehlerpfad geben dieselbe Auskunft, damit ein Anruf nie an einem haengenden Abruf
// stirbt und der Endpunkt nichts ueber vergebene Token verraet.
const HTTP_NOT_FOUND = 404;

export function makeVoiceRoutes({
  store,
  config,
  audit,
  voiceRender,
  directiveSynth,
  ttsStore,
  lifecycle,
  finishCall,
  webhookEvents,
  providerFromHeaders,
  inboundSignatureVerifier,
  terminateAndBillCall,
  billThunk,
}) {
  const { render, turnDirectives, sayInCallVoice, followupTurnDirectives } = voiceRender;

  // EINE Quelle (G5) fuer die TeXML-Antwort "Directiven synthetisieren -> rendern -> als
  // text/xml senden". Provider = call.provider (bei /voice/incoming identisch zum lokalen
  // provider, weil createCall genau diesen speichert). await bleibt beim Aufrufer -> ein
  // Synth-Fehler laeuft in dessen try/catch (byte-identische Fehlerbehandlung).
  async function sendVoiceXml(res, call, directives) {
    const audio = await directiveSynth.synthesizeDirectiveAudio(call, directives);
    res.type("text/xml").send(render(audio, call.provider));
  }

  // P3.1 (PLAN-CONVERSATION-QUALITY-V2): Abschied VOR dem harten Max-Dauer-Cap. Faellt die
  // Restzeit unter den Vorlauf, endet dieser Turn mit einem deterministischen Abschluss-Satz
  // statt mit einem Folge-Gather, den der wortlose Timer-Backstop Sekunden spaeter
  // abschneiden wuerde. Der Cap wird dadurch NICHT verlaengert (Regel 1): der Satz liegt
  // INNERHALB der Frist; terminateCappedCall bleibt unangetastet und beendet den Call
  // weiterhin spaetestens bei der am Call hinterlegten Notbremse - auch wenn ueberhaupt
  // kein Turn mehr kommt.
  // TURN-basiert statt Timer-basiert, weil nur hier ein Request offen ist, in den sich
  // rendern laesst; dadurch laeuft der Pfad ueber voiceRender/directives und bedient beide
  // Provider ohne den optionalen speak-Port.
  // Der Satz ist ein Locale-String, KEIN LLM-Text - er muss auch kommen, wenn das Modell
  // klemmt. Genug Restzeit ODER capFarewellLeadMs=0 (Aus-Schalter) -> null.
  function capFarewellOutcome(call) {
    const remaining = remainingMaxDurationMs(call, Date.now(), MAX_CALL_DURATION_CAP_S);
    if (remaining >= config.safety.capFarewellLeadMs) return null;
    return { speech: localeFor(call.language).capFarewellSpeech, endCall: true };
  }

  // KS-P3 (b): die guthaben-abgeleitete Notbremse EINES Legs. Zweite Nutzung derselben
  // reinen Regel wie im Outbound-Gate (call-duration.js ist die EINE Quelle, G5); hier
  // werden nur ihre zwei Eingaben aus dem Store gezogen. Auch INBOUND bekommt sie: seine
  // KI-Token buchen in jeder Schleifenrunde live auf dieselbe Tenant-Achse (E11-Korrektur),
  // und ohne eigene Frist liefe ein haengendes Inbound-Leg bis zur absoluten Obergrenze.
  // callTariffCentsPerMin traegt die Richtungsregel (inbound: Satz des EIGENEN DID-Landes) -
  // hier NICHT nachgebaut.
  function brakeSecondsFor(leg) {
    return emergencyBrakeSeconds({
      remainingCents: store.tenantBudgetSnapshot(leg.tenantId, config.billing).remainingCents,
      tariffCentsPerMin: callTariffCentsPerMin(leg),
    });
  }

  // AL-P6 (Regel 1): bricht agentTurn wegen einer erschoepften Budget-Achse ab, endet der
  // Call mit demselben Satz wie der Inbound-Gate-Pfad (/voice/incoming) und legt auf -
  // sonst liefe er auf Carrier-Minuten weiter, waehrend das Modell schon nichts mehr
  // beitragen darf. Der Satz ist ein Locale-String, kein LLM-Text. Kein Grund -> null.
  function budgetHangupOutcome(turn, call) {
    if (!isBudgetAxis(turn.stopReason)) return null;
    return { speech: localeFor(call.language).budgetExhaustedHangup, endCall: true };
  }

  // P3.2: gestaffelte Antwort auf einen leeren Gather. Der Streak lebt ephemer am Call;
  // die Staffel selbst ist rein (no-speech-escalation.js).
  function noSpeechOutcome(call) {
    return noSpeechEscalation(store.countNoSpeechTurn(call.id), localeFor(call.language));
  }

  // EINE Quelle (G5) fuer die drei Renderpfade des Turn-Handlers (Modell-Turn, No-Speech,
  // Fehlerpfad): beenden -> Satz + Hangup, sonst Folge-Gather (Mikro offen). Nebeneffekt
  // im Namen (N7, "send"): setzt zugleich den L0-Render-Zeitpunkt, aber nur wenn ein
  // Folge-Turn ueberhaupt erwartet wird.
  async function sendTurnOutcome(res, call, { speech, endCall }) {
    if (!endCall) metrics.recordTurnRendered(call.id);
    const directives = endCall
      ? [sayInCallVoice(call, speech), hangupD()]
      : followupTurnDirectives(call, speech);
    await sendVoiceXml(res, call, directives);
  }

  const router = Router();

  // SEC-P1 (REPLAY-01/02): Wiederholungs-Riegel der zwei ungeschuetzten Webhooks.
  // EINE Instanz je Server (INV-7). Registriert wird er PRO ROUTE, also strukturell
  // HINTER der /voice-Signatur-MW - ein unsignierter Request darf keinen Anker
  // beanspruchen. keepAliveXml ist die Antwort auf eine Wiederholung, deren Wortlaut
  // dieser Prozess nicht mehr kennt (Neustart). Seit IE4 ist sie PFADGERECHT
  // (repeatDeliveryXml): Budget-Bein unveraendert Folge-Gather, uebergebenes Bein ein
  // leeres Dokument. Der ANKER und die Antwortpflicht (immer text/xml, nie ein
  // Fehlerstatus) sind unberuehrt; KEIN Gate wird hier beruehrt (Regel 1).
  const idempotenz = makeWebhookIdempotenz({
    store,
    keepAliveXml: (call) => repeatDeliveryXml(call, { render, followupTurnDirectives }),
  });

  // ---- INV-4 (Pflicht-Kommentar, safety-tragend): TTS-Route ZUERST, DANN Sig-MW, DANN die 4
  // Webhooks (/voice/incoming, /voice/turn, /voice/outbound, /voice/status). Wuerde die
  // Sig-MW VOR die TTS-Route ruecken, wuerde PII-Audio
  // signaturpflichtig (Telnyx kann GET nicht signieren -> 403 -> tote Audio-Ausgabe).
  // Reihenfolge NIEMALS aendern.

  // AUTH-AUSNAHME (Regel 3, begruendet): oeffentlich erreichbar, weil Telnyx diese URL
  // SERVERSEITIG fetcht (kein Provider-Signatur-Header) - deshalb bewusst VOR der
  // /voice-Signaturpruefung registriert (sonst 403). Loest KEINEN Call/keine SMS/keine
  // Kosten aus (Regel 1 unberuehrt); die einzige Absicherung der PII-Audio ist der
  // kryptografisch unratbare Token + kurze TTL + EINMALIGER Abruf (takeOnce). Kein Log
  // von Token/Bytes (kein PII/Secret-Leak, Regel 4).
  // IE7: async, weil der Token vergeben wird, BEVOR die Synthese fertig ist - das Warten
  // auf den Rest liegt hier, nicht mehr im Webhook. Begrenzt ist es durch die Gesamtfrist
  // der Synthese (ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS), nicht durch diesen Handler. Express 4
  // faengt Rejections aus async-Handlern NICHT ab (Muster S1-1 in /voice/incoming) ->
  // Rumpf komplett in try/catch; der Fehlerpfad antwortet wie der Nichtfund, damit ein
  // Anruf nie an einem haengenden Abruf stirbt. Kein Log von Token oder Bytes (Regel 4).
  router.get("/voice/tts/:token", async (req, res) => {
    try {
      const audio = await ttsStore.takeOnce(req.params.token);
      if (!audio) return res.status(HTTP_NOT_FOUND).end();
      res.type(audio.contentType).send(audio.bytes);
    } catch (err) {
      console.error("[voice/tts]", err.message);
      res.status(HTTP_NOT_FOUND).end();
    }
  });

  // ---- Inbound-Signaturpruefung fuer alle /voice-Webhooks (fail-closed) ----
  // Der Provider signiert jeden Request. Ohne diese Pruefung kann jeder, der die URL
  // kennt, Anrufe/Transkripte faelschen und Claude-Turns (=Kosten) ausloesen. Die
  // Krypto (Telnyx-Ed25519) lebt im Adapter; hier bleibt nur das Skip-Gate (Local/Test)
  // und die fail-closed-Antwort. rawBody (req.rawBody) traegt die signierten Bytes.
  // C-P3: es gibt genau EINEN Verifizierer. Alles, was providerFromHeaders nicht als
  // Telnyx erkennt (auch ein Twilio-Signatur-Header), faellt hier auf 403 - die Kette
  // wurde dadurch strenger, nicht schwaecher (s. CLAUDE.md, Absolute Regel 1).
  router.use("/voice", (req, res, next) => {
    if (config.safety.skipTwilioSignatureCheck) return next();
    const ok = inboundSignatureVerifier().verifyInboundSignature({
      headers: req.headers,
      rawBody: req.rawBody,
      url: config.server.publicUrl + req.originalUrl,
      params: req.body || {},
    });
    if (!ok) {
      // OBS-3: Ein fehlgeschlagener Provider-Signatur-Check war bisher stumm (nur 403) -
      // gedrehte Keys, ein falsch signierender Client oder gestoerte Zustellung blieben in
      // den Render-Logs unsichtbar (Regel 7). Genau EINE PII-/secret-freie Zeile: der
      // query-freie Pfad (kein PII) + die Provider-HERKUNFT als Enum-Token aus
      // providerFromHeaders (der EINZIGEN Header->Provider-Karte, G5) - NIE Header-Werte,
      // rawBody oder Timestamps (Regel 4). req.baseUrl+req.path statt nacktem req.path:
      // innerhalb von app.use("/voice", ...) ist req.path MOUNT-RELATIV (Express strippt
      // den "/voice"-Praefix), req.baseUrl liefert genau diesen Praefix zurueck - beide
      // zusammen ergeben den vollen, weiterhin query-freien Routen-Pfad. Additiv VOR dem
      // unveraenderten fail-closed-403.
      console.warn(
        `[voice-signature] ungueltige Inbound-Signatur -> 403 (path=${req.baseUrl}${req.path} provider=${providerFromHeaders(req.headers) || "unknown"})`,
      );
      return res.status(403).send("invalid inbound signature");
    }
    next();
  });

  // ---------------- INBOUND ----------------
  // Provider-Nummer -> "A call comes in" -> POST {PUBLIC_URL}/voice/incoming
  // Die Provider-Signatur ist hier bereits fail-closed geprueft (app.use("/voice")).
  // Erst danach wird To gelesen und auf einen Tenant aufgeloest (Anti-Spoof: To
  // vor der Signatur waere Tenant-Spoofing). Unbekannte/fehlende To -> hoeflicher
  // Hangup, KEIN Default-Tenant, KEIN aktiver Call (nicht-routbare Nummer kostet
  // nichts).
  router.post("/voice/incoming", idempotenz.forIncoming, async (req, res) => {
    // Provider EINMAL aus dem (bereits fail-closed signatur-geprueften) Header
    // ableiten. Skip-Signature/lokale curl-Tests ohne Provider-Header -> DEFAULT_PROVIDER,
    // seit C-P1 also der Telnyx-Pfad - bewusst und getestet ("C-P1 B",
    // test/provider-threading.test.js), kein Zufall des Bestands. Quelle ist der
    // Signatur-Header, nicht To/provider (Anti-Spoof: liegt strukturell HINTER der Signatur).
    const provider = providerFromHeaders(req.headers) ?? DEFAULT_PROVIDER;
    // S1-1: kompletter Handler-Body in try/catch. Seit await synthesizeDirectiveAudio
    // ist dieser Handler async - Express 4 faengt Promise-Rejections aus async-Handlern
    // NICHT ab, eine Exception ohne try/catch wuerde zur stillen unhandledRejection statt
    // einer Antwort, der eingehende Anruf haenge bis zum Provider-Timeout. call bleibt
    // ausserhalb sichtbar (let statt const), damit der Fehlerpfad - falls die Exception
    // erst NACH der Call-Erzeugung auftritt - dieselbe Sprache wie der Erfolgspfad
    // spricht; vor der Erzeugung faellt localeFor(undefined) fail-safe auf DE zurueck
    // (wie der Unrouted-Pfad unten).
    let call;
    try {
      const to = normNum(req.body.To);
      // EIN Lookup liefert tenantId UND number.language (F1 P4, §0-A: die angerufene Nummer
      // ist der Geo-Anker). null = unbekannte/nicht-aktive Nummer -> fail-closed Hangup.
      const numberRecord = store.numberRecordByE164(to);
      if (!numberRecord) {
        audit("inbound_unrouted", req, `to=${to || "-"}`);
        // Kein Tenant, kein Call -> keine Sprache ableitbar; der hoefliche Hangup bleibt DE
        // (kein Locale-Lookup ohne Tenant, nicht ueber-engineeren).
        return res
          .type("text/xml")
          .send(
            render([sayD("Diese Nummer ist nicht erreichbar. Auf Wiederhören."), hangupD()], provider),
          );
      }
      const tenantId = numberRecord.tenantId;
      // Aufloesungs-Praezedenz (#8): settings.language -> number.language ->
      // tenant.defaultLanguage -> Weltdefault (P10). Hier liegt der Geo-Anker der
      // angerufenen Nummer vor.
      const language = store.resolveCallLanguage({ tenantId, numberRecord });
      const locale = localeFor(language);

      // KS-P9/E10: nur noch die pro-Tenant-Decke. Die Plattform-Achse misst und warnt,
      // sie sperrt nicht mehr - kein Kunde wird abgewiesen, weil ein anderer Geld ausgab.
      // (Dass Inbound ueberhaupt budget-gesperrt wird, ist Gegenstand von KS-P10.)
      if (store.budgetExceeded(tenantId, config.billing)) {
        return res
          .type("text/xml")
          .send(render([sayD(locale.budgetExhaustedHangup, locale.voiceProfile), hangupD()], provider));
      }

      // KS-P3 (b): das Leg EINMAL beschrieben, damit die Notbremse dieselbe Richtung/
      // dasselbe Ziel sieht, die auch persistiert werden (kein zweiter, abweichender
      // Nachbau der Leg-Felder fuer die Satz-Ableitung).
      const inboundLeg = {
        direction: "inbound",
        from: req.body.From || "unbekannt",
        to,
        twilioSid: req.body.CallSid,
        tenantId,
        provider,
        language,
      };
      call = store.createCall({ ...inboundLeg, maxDurationS: brakeSecondsFor(inboundLeg) });
      store.markAnswered(call.id);
      lifecycle.armMaxDurationTimer(call, req.body.CallSid);

      store.recordCostProfile(call.id, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
      const ctx = store.tenantContext(call.tenantId);
      // GAP-14: der Pflichtsatz wird GERENDERT, nie gepromptet (Regel-2-Analogie fuer
      // Inbound) - und nur vorangestellt, wenn er im Greeting fehlt (kein Doppelsatz).
      // Deckt den TeXML-Gather. PROMPT-03: die gespeicherte Vorlage folgt der Anrufsprache
      // (greetingForLanguage) - der deutsche Seed-Default darf einem EN-/FR-Tenant nicht
      // mehr vorgelesen werden. replaceAll bleibt VOR dem Pflichtsatz-Praefix: der
      // Fehlerpfad bei greeting=null wirft unveraendert (voice-incoming-catch-path,
      // greetingForLanguage(null, ...) gibt null zurueck).
      const greeting = withInboundNotice(
        greetingForLanguage(ctx.settings.greeting, language).replaceAll("{owner}", ctx.ownerName),
        locale.inboundNotice,
      );

      // Die Sonde je Leg (telephony/inbound-path.js): genau eine Zeile, auch im Normalfall.
      logInboundPath({ callId: call.id, path: INBOUND_PATH.BUDGET });

      store.addTranscript(call.id, "agent", greeting);
      await sendVoiceXml(res, call, turnDirectives(call, greeting));
    } catch (err) {
      console.error("[incoming]", err.message);
      // S1-1: gracefuler Fehler-TeXML-Fallback statt haengendem Call (spiegelt /voice/turn,
      // Runde 2 S-A: sichtbar statt still). Kein LLM-Aufruf im Greeting-Pfad -> immer
      // turnErrorSpeech (kein llmDegradedSpeech-Fall wie bei /voice/turn). Vor der Call-
      // Erzeugung gibt es noch kein call.provider fuer synthesizeDirectiveAudio (der Guard
      // dort wuerde selbst werfen) -> reines Azure-<Say> wie der Unrouted-Pfad oben.
      const locale = localeFor(call?.language);
      const errorDirectives = [sayD(locale.turnErrorSpeech, locale.voiceProfile), hangupD()];
      const outDirectives = call ? await directiveSynth.synthesizeDirectiveAudio(call, errorDirectives) : errorDirectives;
      res.type("text/xml").send(render(outDirectives, provider));
    }
  });

  // ---------------- GESPRAECHS-TURN (Budget-Engine, beide Richtungen) ----------------
  router.post("/voice/turn", idempotenz.forTurn, async (req, res) => {
    let call = store.getCall(req.query.callId);
    if (!call || call.status !== "active") {
      // F12 (A6): dem Prozess unbekannter, aber in der DB aktiver Call (Deploy-Instanz-
      // wechsel)? Erst RLS-sauber re-attachen+klassifizieren, DANN erst fail-closed auflegen.
      const reattached = await lifecycle.reattachActiveCall(req.query.callId);
      if (reattached.call) {
        call = reattached.call; // aktiver Call, Cap re-armiert -> normal fortfahren
      } else {
        // Fail-closed Hangup wie im Bestand, aber NICHT mehr still (Runde 2, S-A):
        // dieses Muster entsteht real, wenn ein Deploy-Instanzwechsel den in-memory-
        // Call verliert (Testanruf call_mr3lg2g7t9zg) - ohne Logzeile ist der Vorfall
        // in den Render-Logs unsichtbar (CLAUDE.md Regel 7). callId ist server-
        // generiert, kein PII. Anders als /voice/status (Rauschen) ist ein Turn-
        // Webhook ohne aktiven Call IMMER ein totes Live-Gespraech.
        // Warn-Log NUR bei echt unbekanntem Call - ein terminalisiertes Ueber-Zeit-Leg
        // (logUnknown:false) WAR aktiv, "kein aktiver Call" waere dort irrefuehrend (G2).
        if (reattached.logUnknown)
          console.warn(
            `${TURN_LOG_PREFIX} kein aktiver Call (callId=${req.query.callId || "-"} ${call ? `status=${call.status}` : "unbekannt"}) -> Hangup`,
          );
        return res.type("text/xml").send(render([hangupD()]));
      }
    }
    // L0: Luecke seit dem Render des vorigen Folge-Gathers ~ STT-Finalisierungs-Totzeit.
    metrics.logTurnGap(call.id);

    const heard = webhookEvents(call.provider).parseSpeechResult(req.body);
    // P2a: LAENGE des Gehoerten als Truncation-Signal (P9-Grundlage), NIE der Text.
    // Unbedingt - auch chars=0 ist ein Signal (No-Speech vs. abgeschnittener Satz).
    metrics.logSpeechResult({ callId: call.id, chars: heard.length });
    try {
      // G3/G26-Fix (Runde 2): callerHasSpoken (claude.js) statt blosser Zeilen-Existenz -
      // sonst haette outbound schon ein einzelnes aufgezeichnetes Rausch-/Echo-Fragment
      // diesen Kurzschluss fuer den Rest des Calls vor agentTurn gestellt und den R4-Empty-
      // Turn-Zaehler (unansweredAgentTurns, nur bei echtem agentTurn-Aufruf neu ausgewertet)
      // dauerhaft eingefroren (siehe Kommentar an callerHasSpoken).
      if (!heard && callerHasSpoken(call)) {
        // P3.2: gestaffelte Eskalation statt desselben Satzes bis zum stillen Cap.
        // P3.1 hat Vorrang: laeuft die Restzeit aus, ist ein weiterer Reprompt sinnlos -
        // der Timer-Backstop wuerde ihn wortlos abschneiden.
        return await sendTurnOutcome(res, call, capFarewellOutcome(call) ?? noSpeechOutcome(call));
      }
      // P3.2: eine VERSTANDENE Aeusserung bricht die Staffel ab (konsekutiv, nicht kumulativ).
      if (heard) store.clearNoSpeechStreak(call.id);
      const modelOutcome = await agentTurn(call, heard || null);
      // P3.1: NACH agentTurn geprueft - sonst fiele die letzte Anrufer-Zeile aus Transkript,
      // Summary und Export. Trifft der Cap-Vorlauf, ersetzt der deterministische Abschluss-
      // Satz die Modell-Antwort (derselbe [Say, Hangup]-Zweig wie ein echtes end_call).
      await sendTurnOutcome(
        res,
        call,
        capFarewellOutcome(call) ?? budgetHangupOutcome(modelOutcome, call) ?? modelOutcome,
      );
    } catch (err) {
      console.error("[turn]", err.message);
      // Schicht 2 (P3b-R): bei anhaltender LLM-Nichtverfuegbarkeit
      // (Breaker offen ODER Retries erschoepft -> LlmUnavailableError aus llm.complete)
      // wuerdevoll und kontrolliert beenden statt mit einem nackten "technischen Problem"
      // aufzulegen: der Agent verabschiedet sich hoeflich und sichert die Rueckmeldung zu.
      // KEIN Retry hier (der Seam hat bereits begrenzt+selektiv retried); das Gespraech
      // endet kontrolliert (Say + Hangup), kein stummer Abbruch. Jeder ANDERE Fehler
      // (nicht-transient, z.B. 4xx/Auth) bleibt terminal wie im Bestand.
      // FW2-B: der Guthaben-Ausfall ist auf diesem Weg bisher nicht von einem beliebigen
      // Fehler unterscheidbar - die gemeinsame Alarm-Funktion (llm-billing-outage.js),
      // plus der Latch. Der Degradations-/Sendepfad bleibt unveraendert.
      noteLlmBillingOutage(err, { logPrefix: TURN_LOG_PREFIX, payload: { callId: call.id } });
      const locale = localeFor(call.language);
      await sendTurnOutcome(res, call, { speech: degradedSpeechFor(err, locale), endCall: true });
    }
  });

  // ---------------- OUTBOUND: Angerufener nimmt ab ----------------
  router.post("/voice/outbound", async (req, res) => {
    let call = store.getCall(req.query.callId);
    if (!call) {
      // F12 (A6): siehe /voice/turn - erst re-attachen+klassifizieren, dann fail-closed.
      const reattached = await lifecycle.reattachActiveCall(req.query.callId);
      if (reattached.call) {
        call = reattached.call;
      } else {
        // Sichtbarer fail-closed Hangup (Runde 2, S-A) - Begruendung siehe /voice/turn.
        if (reattached.logUnknown)
          console.warn(`[voice/outbound] unbekannter Call (callId=${req.query.callId || "-"}) -> Hangup`);
        return res.type("text/xml").send(render([hangupD()]));
      }
    }
    call.twilioSid = req.body.CallSid || call.twilioSid;
    store.markAnswered(call.id);
    store.save();

    // GAP-21: nur bei EINDEUTIGEM Maschinen-Ergebnis auflegen. Unbekannt/fehlend/human ->
    // Bestandspfad byte-identisch (fail-open Richtung Gespraech: ein leise antwortender
    // Mensch darf nie abgewuergt werden). Kein neuer Endpunkt, keine neue Auth-Flaeche:
    // der Wert kommt im bereits signaturgeprueften Webhook-Body. markAnswered ist bewusst
    // vorher gelaufen (der Leg WURDE abgenommen und ist beim Carrier abrechenbar) - das
    // Settlement laeuft unveraendert ueber /voice/status.
    if (
      config.telephony.machineDetection.enabled &&
      webhookEvents(call.provider).parseAnsweredBy(req.body) === ANSWERED_BY.MACHINE
    ) {
      console.log(`[voice/outbound] Anrufbeantworter erkannt (callId=${call.id}) -> Hangup`);
      return res.type("text/xml").send(render([hangupD()], call.provider));
    }

    // Schicht 1 (P3b-R) + G2: /voice/outbound ist LLM-FREI. Der gesamte gesprochene
    // Erst-Turn (Pflicht-Offenlegung Regel 2 als erster Satz + Bruecke + gekapptes
    // Anliegen) wird als EIN <Say> INNERHALB des <Gather> gerendert - byte-strukturgleich
    // zum bewaehrten Inbound-Greeting (turnDirectives(call, greeting)). Damit ist das
    // Mikrofon sofort offen und der Angerufene kann direkt antworten (loest den leeren-
    // Erst-Gather-Deadlock). openingText ist rein synchron -> der Webhook haengt NIE an
    // einem flackernden Upstream. Das Anliegen wird hier deterministisch genannt; der
    // erste LLM-Turn (/voice/turn) wiederholt es nicht (systemPrompt-Hinweis).
    const opening = openingText(call);
    store.addTranscript(call.id, "agent", opening);
    await sendVoiceXml(res, call, turnDirectives(call, opening));
  });

  router.post("/voice/status", async (req, res) => {
    res.sendStatus(200);
    let call = store.getCall(req.body.CallSid) || store.getCall(req.query.callId || "");
    if (!call) {
      // F12 (A6) Runde 2 (S1-1): denselben reattachActiveCall()-Pfad wie /voice/turn und
      // /voice/outbound nutzen - NICHT store.attachActiveCall direkt. Ein direkter Aufruf
      // wuerde ein Ueber-Zeit-Leg (Deploy-Instanzwechsel liefert answered/completed verspaetet)
      // OHNE Restzeit-Pruefung und OHNE Timer-Rearm als aktiv in den Spiegel zurueckholen -
      // der Call liefe danach fuer den Rest seiner Lebensdauer OHNE Max-Dauer-Cap (Regel 1),
      // weil ein folgendes /voice/turn ihn dann schon aktiv im Spiegel findet und
      // reattachActiveCall nie wieder aufruft. RLS-scoped, nur DB-bestaetigt (nie der Body).
      const reattached = await lifecycle.reattachActiveCall(req.query.callId || "");
      // Beide null-Faelle bleiben still (Bestand: kein PII/Debug-Rauschen): logUnknown=true
      // -> wirklich unbekannt; logUnknown=false -> Ueber-Zeit-Leg wurde bereits terminalisiert
      // + gebucht (terminateCappedCall), hier ist nichts mehr zu tun.
      if (!reattached.call) return;
      call = reattached.call;
    }
    const provider = call.provider || DEFAULT_PROVIDER;

    // TTS-Stoerung sichtbar machen (graceful degradation): Telnyx meldet ein
    // fehlgeschlagenes server-seitiges TTS (<Say> ueber Azure-NTTS) als Command-Event
    // OHNE CallStatus. Ein solches Event ist KEIN Lifecycle-Uebergang -> hier terminieren,
    // sonst wuerde es mit status=undefined faelschlich als Lifecycle-Event geloggt. Nur
    // der Fehlschlag wird geloggt (OK-Speak waere Rauschen) und macht die sporadische
    // Azure-Stoerung zum diagnostizierbaren, PII-freien Signal (reason = Telnyx-Token).
    const speak = webhookEvents(provider).parseSpeakOutcome(req.body);
    if (speak.outcome !== SPEAK_OUTCOME.NONE) {
      if (speak.outcome === SPEAK_OUTCOME.FAILED)
        console.error(
          "[voice/speak]",
          JSON.stringify({ callId: call.id, provider, outcome: speak.outcome, reason: speak.reason }),
        );
      return;
    }

    const { status: callStatus, diagnostics } = webhookEvents(provider).parseLifecycleEvent(req.body);
    // PII-frei (Pre-Mortem): nur callId/Status/Provider/Diagnose ins Log, NIE
    // From/To/Telefonnummern. Macht Telnyx-Lifecycle-Events + CallDuration + die
    // Hangup-Ursache (HangupCause/HangupSource/SipHangupCause) sichtbar - sonst ist
    // das Telnyx-Call-Ende beim Debugging blind.
    console.log(
      "[voice/status]",
      JSON.stringify({ callId: call.id, status: callStatus, provider, diagnostics }),
    );
    if (callStatus === "in-progress" || callStatus === "answered")
      return void store.markAnswered(call.id);
    if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) return;
    // CDF1: maschinenlesbaren Fehlergrund aus der bereits berechneten Diagnose (PII-frei).
    // completed -> callFailureReason null -> recordFailureReason No-op (kein Save).
    // OUTBOUND-E3b (Befund C-A): der Grund wird INNERHALB von persistEndWithReason
    // geschrieben (telephony/call-termination.js), NICHT mehr als freie Anweisung davor -
    // eine freie Anweisung verletzte hier bereits einmal die Reihenfolge, GRUEN blieb die
    // gesamte Suite trotzdem (test/fehlergrund-reihenfolge-riegel.test.js faengt das jetzt).
    // C5 (Struct-4): Settlement-Gateway statt manuellem endCallRecord+finishCall-Paar - bill
    // (Settlement) ist bei terminateAndBillCall ein strukturell erzwungenes Pflichtfeld (Fail-
    // Fast-Guard, verhindert die C5-Bugklasse: ein neuer Terminierungspfad vergisst finishCall).
    // hangUp:null: der Provider hat den Call bereits beendet (dieses Event IST der Hangup), kein
    // eigener Hangup-Versuch noetig (bereits getesteter Zweig, call-termination-order.test.js).
    const endeSchreiben = () => {
      if (call.status === "active")
        store.endCallRecord(call.id, callStatus === "completed" ? "completed" : "failed");
    };
    await terminateAndBillCall({
      persistEnd: persistEndWithReason({ store, callId: call.id, endCall: endeSchreiben, reason: callFailureReason({ status: callStatus, diagnostics }) }),
      hangUp: null,
      bill: billThunk(finishCall, store, call.id),
      callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
    });
  });

  return router;
}
