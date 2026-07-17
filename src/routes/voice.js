// ---- makeVoiceRoutes (Server-Slim P11) --------------------------------------------
// Extrahierte Voice-Webhook-Gruppe (GET /voice/tts/:token, die /voice-Signatur-MW,
// POST /voice/incoming|turn|outbound|status|call-control) als Factory mit Dependency-
// Injection - gleiches Muster wie makeCallRoutes/makeReadRoutes. Teil der
// server.js-Decomposition (PLAN-SERVER-SLIM P11): REINE Verschiebung, Verhalten
// unveraendert (byte-identische Pfade/Status/Bodies/Audit-Events). G5-1-Dedup
// (attachOrHangup) ist ausdruecklich Folgearbeit, NICHT diese Phase. HOECHSTES
// EINZEL-RISIKO der server.js-Decomposition: hier leben die Safety-Gates fuer
// Provider-Signatur (Regel 3) und die Offenlegungs-Textpfade (Regel 2).
//
// Import-vs-Inject wie api-calls.js (P9): reine Modul-Konstanten/Praedikate/Formatierer
// mit EINER kanonischen Heimat (normNum/DEFAULT_PROVIDER, providerSupports/CAPABILITY
// (P5, registry.js), sayD/hangupD, SPEAK_OUTCOME, localeFor, callFailureReason,
// degradedSpeechFor, agentTurn/openingText/callerHasSpoken, metrics,
// startInboundAiAssistant/inboundCallControlId, makeCallControlIngest) werden direkt
// importiert (G5 "eine Quelle"). Laufzeit-Instanzen (voiceRender/directiveSynth/
// ttsStore/lifecycle/finishCall/watchdog, INV-7), der Provider-Dispatch-Seam
// (voiceControl/webhookEvents/providerFromHeaders/inboundSignatureVerifier, DIP) sowie
// der Settlement-Seam (terminateAndBillCall/billThunk) und config/store/audit werden
// injiziert (INV-7 "eine Instanz").
import { Router } from "express";
import { normNum, DEFAULT_PROVIDER } from "../store/defaults.js";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";
import { say as sayD, hangup as hangupD } from "../telephony/directives.js";
import { SPEAK_OUTCOME } from "../telephony/adapters/telnyx/speak-events.js";
import { localeFor } from "../i18n/locales.js";
import { callFailureReason } from "../telephony/failure-reason.js";
import { degradedSpeechFor } from "../llm.js";
import { agentTurn, openingText, callerHasSpoken } from "../claude.js";
import { metrics } from "../metrics.js";
import { startInboundAiAssistant, inboundCallControlId } from "../telnyx-inbound.js";
import { makeCallControlIngest } from "../telnyx-call-control-ingest.js";

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
// Der Aufrufer hat call -> localeFor(call.language).<feld>. DE-Werte sind byte-identisch
// zum frueheren Inline-Bestand (i18n-Test pinnt sie).

// P8: TeXML-Handoff-Antwort auf /voice/incoming, wenn der Call-Control-Assistant den Leg
// uebernimmt. Leere Direktivenliste (renderDirectives([]) -> <Response></Response>) als
// Platzhalter; die exakte Telnyx-Handoff-Direktive ist live unbestaetigt (P0/P11). Zentral
// benannt statt inline-[] gestreut.
const INBOUND_ASSISTANT_HANDOFF = [];

export function makeVoiceRoutes({
  store,
  config,
  audit,
  voiceRender,
  directiveSynth,
  ttsStore,
  lifecycle,
  finishCall,
  voiceControl,
  webhookEvents,
  providerFromHeaders,
  inboundSignatureVerifier,
  terminateAndBillCall,
  billThunk,
  watchdog,
}) {
  const { render, turnDirectives, sayInCallVoice, followupTurnDirectives, streamDirectives } =
    voiceRender;

  // EINE Quelle (G5) fuer die TeXML-Antwort "Directiven synthetisieren -> rendern -> als
  // text/xml senden". Provider = call.provider (bei /voice/incoming identisch zum lokalen
  // provider, weil createCall genau diesen speichert). await bleibt beim Aufrufer -> ein
  // Synth-Fehler laeuft in dessen try/catch (byte-identische Fehlerbehandlung).
  async function sendVoiceXml(res, call, directives) {
    const audio = await directiveSynth.synthesizeDirectiveAudio(call, directives);
    res.type("text/xml").send(render(audio, call.provider));
  }

  // C-Telnyx-Inbound (P8, Befund 8): startet - falls einschlaegig - den Call-Control-Assistant
  // fuer einen Inbound-Leg und liefert die Handoff-TeXML; sonst null (Aufrufer faellt fail-safe
  // auf den bestehenden TeXML-Gather-Pfad zurueck). ERBT Signatur (app.use "/voice"), Tenant-
  // Resolve (numberRecordByE164) UND Budget-Gate vom Aufrufer - KEIN neuer Gate, dieser Helper
  // fuegt keinen hinzu. Nur bei aktivem Flag + signatur-authentifiziertem Telnyx-Provider
  // (Anti-Spoof: provider stammt aus dem Signatur-Header, nicht aus To/Body). callControlId
  // fehlt (Twilio ODER TeXML-Feld absent) -> null, kein kaputter Assistant-Pfad. Der Max-Dauer-
  // Timer ist beim Aufrufer BEREITS armiert; terminateCappedCall liest den Call frisch und
  // trifft via hangUpAction(callControlId) den Call-Control-Hangup, sobald callControlId
  // persistiert ist (P6) - KEIN Re-Arm (zweiter Timer = Leak). Exakte Handoff-Direktive live
  // unbestaetigt (wie P4-Adapter-Body-Form) - mit dem Owner in P0/P11 fixen.
  async function inboundAssistantHandoffXml({ call, provider, body, greeting, voiceProfile }) {
    if (!(config.telnyxAssistant.enabled && providerSupports(provider, CAPABILITY.AI_ASSISTANT))) return null;
    const callControlId = inboundCallControlId(body);
    if (!callControlId) return null;
    await startInboundAiAssistant({ store, voiceControl, config, call, callControlId, greeting, voiceProfile });
    return render(INBOUND_ASSISTANT_HANDOFF, provider);
  }

  const router = Router();

  // ---- INV-4 (Pflicht-Kommentar, safety-tragend): TTS-Route ZUERST, DANN Sig-MW, DANN die 5
  // Webhooks (/voice/incoming, /voice/turn, /voice/outbound, /voice/status,
  // /voice/call-control). Wuerde die Sig-MW VOR die TTS-Route ruecken, wuerde PII-Audio
  // signaturpflichtig (Telnyx kann GET nicht signieren -> 403 -> tote Audio-Ausgabe).
  // Reihenfolge NIEMALS aendern.

  // AUTH-AUSNAHME (Regel 3, begruendet): oeffentlich erreichbar, weil Telnyx diese URL
  // SERVERSEITIG fetcht (kein Provider-Signatur-Header) - deshalb bewusst VOR der
  // /voice-Signaturpruefung registriert (sonst 403). Loest KEINEN Call/keine SMS/keine
  // Kosten aus (Regel 1 unberuehrt); die einzige Absicherung der PII-Audio ist der
  // kryptografisch unratbare Token + kurze TTL + EINMALIGER Abruf (takeOnce). Kein Log
  // von Token/Bytes (kein PII/Secret-Leak, Regel 4).
  router.get("/voice/tts/:token", (req, res) => {
    const audio = ttsStore.takeOnce(req.params.token);
    if (!audio) return res.status(404).end();
    res.type(audio.contentType).send(audio.bytes);
  });

  // ---- Inbound-Signaturpruefung fuer alle /voice-Webhooks (fail-closed) ----
  // Der Provider signiert jeden Request. Ohne diese Pruefung kann jeder, der die URL
  // kennt, Anrufe/Transkripte faelschen und Claude-Turns (=Kosten) ausloesen. Die
  // Krypto (Twilio-HMAC) lebt im Adapter; hier bleibt nur das Skip-Gate (Local/Test)
  // und die fail-closed-Antwort. rawBody (req.rawBody) ist fuer kuenftige Provider da.
  router.use("/voice", (req, res, next) => {
    if (config.skipTwilioSignatureCheck) return next();
    const ok = inboundSignatureVerifier().verifyInboundSignature({
      headers: req.headers,
      rawBody: req.rawBody,
      url: config.publicUrl + req.originalUrl,
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
  // Twilio-Nummer -> "A call comes in" -> POST {PUBLIC_URL}/voice/incoming
  // Die Twilio-Signatur ist hier bereits fail-closed geprueft (app.use("/voice")).
  // Erst danach wird To gelesen und auf einen Tenant aufgeloest (Anti-Spoof: To
  // vor der Signatur waere Tenant-Spoofing). Unbekannte/fehlende To -> hoeflicher
  // Hangup, KEIN Default-Tenant, KEIN aktiver Call (nicht-routbare Nummer kostet
  // nichts).
  router.post("/voice/incoming", async (req, res) => {
    // Provider EINMAL aus dem (bereits fail-closed signatur-geprueften) Header
    // ableiten. Skip-Signature/lokale curl-Tests ohne Provider-Header -> Default
    // twilio -> byte-identisch zum Bestand. Quelle ist der Signatur-Header, nicht
    // To/provider (Anti-Spoof: liegt strukturell HINTER der Signatur).
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
        // (byte-identisch zum Bestand, nicht ueber-engineeren).
        return res
          .type("text/xml")
          .send(
            render([sayD("Diese Nummer ist nicht erreichbar. Auf Wiederhoeren."), hangupD()], provider),
          );
      }
      const tenantId = numberRecord.tenantId;
      // Aufloesungs-Praezedenz (#8): settings.language -> number.language ->
      // tenant.defaultLanguage -> "de". Hier liegt der Geo-Anker der angerufenen Nummer vor.
      const language = store.resolveCallLanguage({ tenantId, numberRecord });
      const locale = localeFor(language);

      // Schnittmenge (R2): pro-Tenant-Budget UND globaler Plattform-Notaus muessen
      // frei sein. Fuer owner-only fallen beide zusammen -> byte-identisch zum Bestand.
      if (store.budgetExceeded(tenantId, config) || store.globalBudgetExceeded(config)) {
        return res
          .type("text/xml")
          .send(render([sayD(locale.budgetExhaustedHangup, locale.voiceProfile), hangupD()], provider));
      }

      call = store.createCall({
        direction: "inbound",
        from: req.body.From || "unbekannt",
        to,
        twilioSid: req.body.CallSid,
        tenantId,
        provider,
        language,
      });
      store.markAnswered(call.id);
      lifecycle.armMaxDurationTimer(call, req.body.CallSid);

      if (config.voiceEngine === "realtime") {
        return res.type("text/xml").send(render(streamDirectives(call), provider));
      }

      const ctx = store.tenantContext(call.tenantId);
      const greeting = ctx.settings.greeting.replaceAll("{owner}", ctx.ownerName);

      // P8: Handoff an den Call-Control-Assistant, falls einschlaegig; sonst (null) faellt
      // der Aufrufer fail-safe auf den bestehenden TeXML-Gather-Pfad zurueck (byte-identisch).
      const handoffXml = await inboundAssistantHandoffXml({
        call,
        provider,
        body: req.body,
        greeting,
        voiceProfile: locale.voiceProfile,
      });
      if (handoffXml) return res.type("text/xml").send(handoffXml);

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
  router.post("/voice/turn", async (req, res) => {
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
            `[voice/turn] kein aktiver Call (callId=${req.query.callId || "-"} ${call ? `status=${call.status}` : "unbekannt"}) -> Hangup`,
          );
        return res.type("text/xml").send(render([hangupD()]));
      }
    }
    // L0: Luecke seit dem Render des vorigen Folge-Gathers ~ STT-Finalisierungs-Totzeit.
    metrics.logTurnGap(call.id);

    const heard = webhookEvents(call.provider).parseSpeechResult(req.body);
    try {
      // G3/G26-Fix (Runde 2): callerHasSpoken (claude.js) statt blosser Zeilen-Existenz -
      // sonst haette outbound schon ein einzelnes aufgezeichnetes Rausch-/Echo-Fragment
      // diesen Kurzschluss fuer den Rest des Calls vor agentTurn gestellt und den R4-Empty-
      // Turn-Zaehler (unansweredAgentTurns, nur bei echtem agentTurn-Aufruf neu ausgewertet)
      // dauerhaft eingefroren (siehe Kommentar an callerHasSpoken).
      if (!heard && callerHasSpoken(call)) {
        metrics.recordTurnRendered(call.id); // L0: Folge-Gather offen -> Render-Zeitpunkt
        const reprompt = followupTurnDirectives(call, localeFor(call.language).noSpeechReprompt);
        return await sendVoiceXml(res, call, reprompt);
      }
      const { speech, endCall } = await agentTurn(call, heard || null);
      const directives = endCall
        ? [sayInCallVoice(call, speech), hangupD()]
        : followupTurnDirectives(call, speech);
      if (!endCall) metrics.recordTurnRendered(call.id); // L0: nur wenn ein Folge-Turn folgt
      await sendVoiceXml(res, call, directives);
    } catch (err) {
      console.error("[turn]", err.message);
      // Schicht 2 (P3b-R): bei anhaltender LLM-Nichtverfuegbarkeit
      // (Breaker offen ODER Retries erschoepft -> LlmUnavailableError aus llm.complete)
      // wuerdevoll und kontrolliert beenden statt mit einem nackten "technischen Problem"
      // aufzulegen: der Agent verabschiedet sich hoeflich und sichert die Rueckmeldung zu.
      // KEIN Retry hier (der Seam hat bereits begrenzt+selektiv retried); das Gespraech
      // endet kontrolliert (Say + Hangup), kein stummer Abbruch. Jeder ANDERE Fehler
      // (nicht-transient, z.B. 4xx/Auth) bleibt terminal wie im Bestand.
      const locale = localeFor(call.language);
      const speech = degradedSpeechFor(err, locale);
      const errorDirectives = [sayInCallVoice(call, speech), hangupD()];
      await sendVoiceXml(res, call, errorDirectives);
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

    if (config.voiceEngine === "realtime") {
      return res.type("text/xml").send(render(streamDirectives(call), call.provider));
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
    // CDF1: maschinenlesbaren Fehlergrund aus der bereits berechneten Diagnose persistieren
    // (PII-frei). completed -> callFailureReason null -> recordFailureReason No-op (kein Save).
    store.recordFailureReason(call.id, callFailureReason({ status: callStatus, diagnostics }));
    // C5 (Struct-4): Settlement-Gateway statt manuellem endCallRecord+finishCall-Paar - bill
    // (Settlement) ist bei terminateAndBillCall ein strukturell erzwungenes Pflichtfeld (Fail-
    // Fast-Guard, verhindert die C5-Bugklasse: ein neuer Terminierungspfad vergisst finishCall).
    // hangUp:null: der Provider hat den Call bereits beendet (dieses Event IST der Hangup), kein
    // eigener Hangup-Versuch noetig (bereits getesteter Zweig, call-termination-order.test.js).
    await terminateAndBillCall({
      persistEnd: () => {
        if (call.status === "active")
          store.endCallRecord(call.id, callStatus === "completed" ? "completed" : "failed");
      },
      hangUp: null,
      bill: billThunk(finishCall, store, call.id),
      callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
    });
  });

  // Call-Control-Event-Ingest (P4.5): additiv, liegt UNTER app.use("/voice") -> Ed25519
  // fail-closed (Regel 3). Faehrt die event-getriebene Zustandsmaschine (answered->
  // Opening-Speak (Offenlegung+Anliegen); speak.ended->ai_assistant_start; hangup->Settlement
  // finishCall). Korrelation ueber ?callId (Muster /voice/status), KEIN Store-Sekundaerindex.
  // Der bestehende Budget/TeXML-Pfad (/voice/status|turn|outbound) bleibt byte-identisch.
  router.post(
    "/voice/call-control",
    makeCallControlIngest({
      store,
      voiceControl,
      finishCall,
      openingText,
      localeFor,
      reattachActiveCall: lifecycle.reattachActiveCall,
      watchdog,
      config,
    }),
  );

  return router;
}
