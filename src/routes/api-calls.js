// ---- makeCallRoutes (Server-Slim-Decomposition) ---------------------------------
// Extrahierte Outbound-Call-Route-Gruppe (POST /api/calls, POST /api/calls/:id/cancel)
// als Factory mit Dependency-Injection - gleiches Muster wie makeReadRoutes/
// makeBillingRoutes. Teil der server.js-Decomposition
// (PLAN-SERVER-SLIM.md): REINE Verschiebung, Verhalten unveraendert (byte-identische
// Pfade/Status/Bodies/Audit-Events). Der G30-Split der langen /api/calls-Handler ist
// bewusste Folgearbeit, NICHT diese Phase.
//
// ABSOLUTE REGEL Safety-Gates (INV-9): die geordnete Outbound-Gate-Kette laeuft
// unveraendert als EINE Schleife ueber das EINE injizierte outboundGates-Array (INV-7,
// wird NICHT hier neu gebaut); armMaxDurationTimer(call,null) (C-Telnyx-Zweig) bzw.
// armMaxDurationTimer(call,tw.sid) (TeXML-Zweig) sitzen an exakt denselben Punkten
// (kein Cap-Verlust). Der Fehlerpfad (terminateAndBillCall + providerStatus-
// Kategorisierung, kein Roh-Provider-/Secret-Leak an den Client) wandert unveraendert.
// Hinter `internalOnly` (Loopback ohne X-Forwarded-For, seit AUTH-P5; seit AUTH-P7 die
// einzige Sicherung), an unveraenderter Mount-Position (vor makeReadRoutes).
// normNum (store/defaults) und isTrunkZeroFormatError/E164_FORMAT_ERROR
// (outbound-gates) kommen direkt aus ihrer Heimat (eine Quelle, G5 - wie
// eurText/spendMonthEndDate in outbound-gates.js); die Laufzeit-Instanzen
// (Gate-Array, Timer, Terminierung, finishCall) und die request-tenant-Resolver werden
// injiziert (EINE Quelle, INV-7).
import { Router } from "express";
import { VOICE_ENGINE } from "../config.js";
import { normNum, CONSULT_ANSWER } from "../store/defaults.js";
import { validateAssistantContext } from "./_validation.js";
import { consultAllowedFor } from "../consult/gate.js";
import { CONSULT_OPEN_MS } from "../consult/in-call.js";
import { isConsultEventId } from "../store/state-ops.js";
import { E164_FORMAT_ERROR, isTrunkZeroFormatError } from "../telephony/outbound-gates.js";
import { startRejectionReason } from "../telephony/failure-reason.js";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";
import { diagnosticRetentionGranted } from "../diagnostic-retention.js";
import { ownerSelfCallGranted } from "../callee-is-owner.js";
// TEIL C (Owner-Auftrag 15.08.2026, cancel_call darf nicht luegen): der Deckelwert ist
// KEINE Magic Number - er ist in elevenlabs/outbound.js besessen (Bewachung statt
// Korrektur der Anbieter-Vorlage, s. dortiger Kommentar).
import { ELEVENLABS_PROVIDER_MAX_DURATION_S, callLocaleOf } from "../elevenlabs/outbound.js";
import { fetchOpeningLine } from "../elevenlabs/opening-line-llm.js";
import { localeFor } from "../i18n/locales.js";
import { fetchPrecallBriefing } from "../precall-briefing.js";
import { metrics } from "../metrics.js";
import { internalOnly } from "../wiring/internal-only.js";

// I10 (call-quality Impl-1): additives Meta in der /api/calls-Erfolgsantwort - zeigt dem
// aufrufenden MCP-Client (place_call), WAS vom optionalen context tatsaechlich ankam.
// NUR bool/count, NIE der Kontext-Inhalt selbst (kein zweiter Transportweg fuer
// HINTERGRUND-Daten). active=false, wenn der Kanal komplett abgeschaltet ist
// (config.tenancy.assistantContextEnabled aus - context ist dann IMMER null, s.o.).
function contextReceivedMeta(context, config) {
  return {
    active: config.tenancy.assistantContextEnabled,
    summary: !!context?.summary,
    key_facts_count: Array.isArray(context?.key_facts) ? context.key_facts.length : 0,
    recipient_relationship: !!context?.recipient_relationship,
    desired_outcome: !!context?.desired_outcome,
  };
}

// OUTBOUND-E2: persistiert den Anbieter-Fehlergrund des Anrufstarts (falls vorhanden) UND
// liefert providerStatus zurueck, das der Aufrufer fuer die Client-Antwort braucht - EINE
// Zeile im Gate-Kernpfad statt zwei getrennter Anweisungen, damit die gepinnte
// Zeilengrenze dieser Riesenfunktion nicht steigt (s. eslint-legacy-exceptions.json,
// "src/routes/api-calls.js" - der G30-Split steht noch aus). Reine Weiterleitung an
// startRejectionReason (telephony/failure-reason.js, EIN Klassifizierer fuer alle drei
// Engine-Zweige) + store.recordFailureReason (set-once, No-op bei null). Kein
// Roh-Provider-Text: startRejectionReason liefert ein Token aus geschlossener Menge.
function recordStartRejectionReason(store, callId, err) {
  const providerStatus = err?.providerStatus;
  store.recordFailureReason(callId, startRejectionReason(providerStatus));
  return providerStatus;
}

// Fail-closed-Ersatz fuer den EL-Anrufstart (s. deps unten): ein eingeschalteter Zweig
// ohne verdrahtete Instanz waehlt NICHT. Die Meldung nennt die gescheiterte Operation und
// ihre Ursache (P8), damit der Fehlerpfad-Log sie nicht raten muss.
function elevenLabsCallNotWired() {
  throw new Error(
    "ELEVENLABS_OUTBOUND_ENABLED ist an, aber der Anrufstart ist nicht verdrahtet (deps.elevenLabsOutbound fehlt)",
  );
}

// S1-5 Fix (Owner-Auftrag 15.08.2026): LAUTER Fallback statt eines stillen No-op fuer
// elevenLabsHangUpAction (s. deps unten). Ein stiller Vorgabewert liesse eine
// Kompositionswurzel, die diesen Parameter vergisst, den EL-Terminierungspfad UNBEMERKT
// abschalten - die Antwort behauptete trotzdem "cancelled" (Absolute Regel 1). Bleibt eine
// Funktion statt eines Pflichtparameters (Tests ohne EL-Wiring bleiben gruen, sie treffen
// nie einen EL-Call - isElevenLabsCall in der Route unten haengt am Anruf, nicht an den
// deps), wird aber LAUT, SOBALD sie tatsaechlich fuer einen EL-Call aufgerufen wird:
// Fehlerebene-Log, dieselbe Meldungsform wie elevenLabsCallNotWired oben (P8). Die Antwort
// bleibt ehrlich unabhaengig vom Grund: hangup_attempted:false (Route unten) sagt bereits
// "kein Beende-Weg lief" - ob die Kennung fehlt oder die Verdrahtung, ist fuer den
// Aufrufer dieselbe Auskunft ("kein Griff auf das Gespraech").
function elevenLabsHangUpActionNotWired(_endActiveCall, call) {
  console.error(
    `[cancel] ELEVENLABS_OUTBOUND_ENABLED ist an, aber elevenLabsHangUpAction ist nicht verdrahtet (deps fehlt, call=${call.id})`,
  );
  return null;
}

// P2b + OC-P1 (PLAN-OWNER-CALL): EINE Lesung der eigenen Nummer fuer BEIDE serverseitigen
// Praedikate dieses Outbound-Calls - zwei store-Aufrufe waeren zwei Momentaufnahmen
// desselben, aenderbaren Feldes (POST /api/self-service/private-number) und liessen
// diagnostic und calleeIsOwner desselben Anrufs theoretisch auseinanderlaufen.
//
// AUF MODUL-EBENE statt inline in der Route: die Route (`makeCallRoutes`, der POST-
// Handler darin) traegt bereits einen erhoehten Altlast-Pin (eslint-legacy-exceptions.json)
// fuer Zeilenzahl/Komplexitaet - ihn fuer OC-P1 WEITER anzuheben braucht die Freigabe des
// Eigentuemers (test/check-staged-suppressions.test.js, "Altlast-Ratsche"). Diese
// Extraktion haelt den Aufrufer bei seiner heutigen Groesse; sie ist ausserdem der
// sauberere Schnitt (G30: eine Aufgabe, ein Name).
//
//   diagnostic           - P2b: darf das Roh-Transkript die Summary ueberleben? (Ziel ==
//                           eigene Nummer, Opt-out im Body moeglich, s.
//                           diagnosticRetentionGranted).
//   calleeIsOwnerOfThisCall - OC-P1: ruft dieser Tenant seine EIGENE hinterlegte Nummer an
//                           (Schalter + Tenant-Allowlist + Ziel, s. ownerSelfCallGranted)?
//                           Serverseitig gesetzt; das Ergebnis geht set-once an den
//                           Anruf-Datensatz und wirkt in dieser Phase noch nirgends.
//
// ctx.to (NICHT die rohe `to`) und ctx.tenantId (der ANRUFENDE Tenant aus resolve_identity)
// sind Pflicht - s. Kommentar an der Aufrufstelle. Bewusst KEIN neues Gate in der
// outboundGates-Kette: beide Praedikate lehnen nie ab, wuerden von keinem Gate gelesen und
// haetten die reihenfolge-gepinnte Safety-Kette nur verbreitert
// (test/outbound-gates-order.test.js bleibt unangetastet).
function resolveCallPrivacyFlags({ store, config, ctx }) {
  const ownNumber = store.tenantPrivateNumber(ctx.tenantId);
  const diagnostic = diagnosticRetentionGranted({
    requested: ctx.b.diagnostic,
    to: ctx.to,
    ownNumber,
    privacy: config.privacy,
  });
  const calleeIsOwnerOfThisCall = ownerSelfCallGranted({
    to: ctx.to,
    ownNumber,
    tenantId: ctx.tenantId,
    enabled: config.voice.ownerSelfCallEnabled,
    allowedTenantIds: config.voice.ownerSelfCallTenantIds,
  });
  return { diagnostic, calleeIsOwnerOfThisCall };
}

// deps: siehe Modul-Doc. arm = { armMaxDurationTimer, armReserveReleaseTimer } aus der EINEN
// lifecycle-Instanz (Cap-/Reserve-Backstop, INV-7); finishCall = callFinish.finishCall (bare,
// EINE Referenz wie in call-lifecycle.js); tenant = { requestTenant, requireTenant,
// tenantOwnsCall } (die EINEN Wurzel-Resolver, kein zweiter); consultDelivery = die EINE
// Consult-Zustell-Instanz (AL-P13, in server.js konstruiert - Poll-Zaehler und Drain-Flag
// leben in ihrem Closure-Scope, eine zweite Instanz haette keine Obergrenze).
export function makeCallRoutes({
  store,
  config,
  audit,
  outboundGates,
  voiceControl,
  originateAiAssistantCall,
  // EL-Anrufstart (dritter Outbound-Weg): die EINE Instanz aus server.js (INV-7) - sie
  // haelt den ziehenden Ergebnisweg, eine zweite haette eine zweite Abhol-Schleife.
  // Ohne verdrahtete Instanz greift der fail-closed Ersatz: bei eingeschaltetem Schalter
  // WIRFT er in den EINEN Fehlerpfad (Call sauber beendet, Reserve frei), statt einen
  // Anruf ueber einen halb verdrahteten Weg auszuloesen.
  originateElevenLabsCall = elevenLabsCallNotWired,
  terminateAndBillCall,
  hangUpAction,
  // TEIL B (Owner-Auftrag 15.08.2026): die EL-Parallele zu hangUpAction (dieselbe DI-Naht,
  // s. telephony/call-termination.js). Der Default ist S1-5-Fix elevenLabsHangUpActionNotWired
  // (s.o.) - LAUT statt still, haelt Tests ohne EL-Wiring aber unveraendert gruen (sie
  // treffen ohnehin nie einen EL-Call).
  elevenLabsHangUpAction = elevenLabsHangUpActionNotWired,
  endActiveCall,
  billThunk,
  finishCall,
  arm: { armMaxDurationTimer, armReserveReleaseTimer },
  tenant: { requestTenant, requireTenant, tenantOwnsCall },
  consultDelivery,
  internalIdentity,
  OWNER_ID,
}) {
  const router = Router();

  // GAP-35: die drei PII-freien Dimensionen des Ablehnungs-Ereignisses. Land und Sprache
  // kommen aus dem TENANT (tenantGeo, reine Query), NICHT aus der Zielnummer: eine aus
  // der E.164-Vorwahl abgeleitete Landangabe waere ein Rufnummern-Fragment im Log
  // (Absolute Regel 4). Ohne aufgeloesten Tenant - outbound_frozen feuert VOR
  // resolve_identity, tenant_reject traegt eine unbekannte Identitaet - liefert tenantGeo
  // beide Achsen als null: geraten wird nichts. Bewusst NICHT resolveCallLanguage, das
  // via settingsFor lazy einen Settings-Bucket anlegen wuerde (Schreib-Nebeneffekt auf
  // einer unaufgeloesten Identitaet).
  function denialDimensions(grund, tenantId) {
    const { country, defaultLanguage } = store.tenantGeo(tenantId);
    return { grund, country, language: defaultLanguage };
  }

  // L5/I5: EINE Sichtbarkeits-Regel fuer alle Call-Routen dieser Datei (G5) - fremder
  // Tenant -> der Aufrufer antwortet 404 (kein Existenz-Leck, NICHT 403). Hinter dem
  // Flag: aus -> ungefiltert wie im Bestand (byte-identisch, auch fuer Calls ohne
  // tenantId). !call short-circuitet vor dem tenantOwnsCall-Zugriff.
  function callVisibleTo(call, tenantId) {
    return Boolean(call) && (!config.tenancy.multiTenant || tenantOwnsCall(call, tenantId));
  }

  // AL-P13: Consult #0. Keine Fragen ODER Faehigkeit nicht freigegeben -> No-op (kein
  // Datensatz, call.consults bleibt null). Rein additiv: der Anruf laeuft davon voellig
  // unberuehrt. Das Audit traegt NUR Zaehler, nie den Fragetext (Regel 4).
  function emitOpeningConsult({ req, call, context, tenantId }) {
    if (!consultAllowedFor(store.resolveProfile(tenantId))) return;
    const questions = Array.isArray(context?.open_questions) ? context.open_questions : [];
    if (!questions.length) return;
    store.emitConsult(call.id, questions);
    audit("consult_emitted", req, `call=${call.id} fragen=${questions.length}`);
  }

  // Outbound-Call starten (Vertrag laut Brief: objective/briefing/constraints/...)
  router.post("/api/calls", internalOnly, async (req, res) => {
    const b = req.body || {};
    let to = normNum(b.to);
    const objective = b.objective || b.goal;
    if (!to || !objective) return res.status(400).json({ error: "to und objective sind Pflicht" });
    // C4 (6.6): 400 VOR jedem Gate und vor dem Dial; 400 = reiner Eingabefehler -> kein Audit
    // (wie die to/objective-Pruefung oben).
    if (isTrunkZeroFormatError(to)) return res.status(400).json({ error: E164_FORMAT_ERROR });

    // Geordnete Safety-/Geld-Gate-Kette (EINE Schleife, EIN Array, Struct-1 P6). ctx
    // transportiert Derivationen (normalisiertes to, tenantId, Absendernummer, Reserve)
    // zwischen den Gates; volle Reihenfolge + Rationale in telephony/outbound-gates.js.
    const ctx = { req, to, objective, b };
    for (const gate of outboundGates) {
      const denial = await gate.run(ctx);
      if (denial) {
        if (denial.audit) {
          audit(denial.audit.event, req, denial.audit.detail);
          // GAP-35: dasselbe Ereignis maschinenlesbar und PII-frei. GLEICHE Bedingung wie
          // das Audit - reine 400er-Eingabefehler sind keine Sicherheits-Ablehnung und
          // erzeugen weiterhin weder Audit- noch Metrik-Zeile.
          metrics.logCallDenied(denialDimensions(denial.audit.grund, ctx.tenantId));
        }
        return res.status(denial.status).json(denial.body);
      }
    }

    // Ab hier ist ctx vollstaendig durch die Gate-Kette befuellt. KRITISCH: ctx.to ist die von
    // normalize_target aufgeloeste Nummer - die lokale `to` bleibt roh und wird ab hier NICHT
    // mehr gelesen.
    const language = store.resolveCallLanguage({ tenantId: ctx.tenantId, numberRecord: ctx.numberRecord });
    // P2b + OC-P1: beide serverseitigen Praedikate (diagnostic, calleeIsOwner) aus EINER
    // Lesung der eigenen Nummer - volle Begruendung an resolveCallPrivacyFlags (Modul-Ebene,
    // haelt diese ohnehin ueberlange Route nicht weiter wachsen, s. dortiger Kommentar).
    const { diagnostic, calleeIsOwnerOfThisCall } = resolveCallPrivacyFlags({
      store,
      config,
      ctx,
    });

    // P8 (PLAN-CONVERSATION-QUALITY-V2): Pre-Call-Briefing VOR dem Waehlen. Laeuft NUR,
    // wenn der Owner selbst keinen Kontext mitgeschickt hat (Owner-Eingabe gewinnt immer),
    // und nur hinter PRECALL_BRIEFING_ENABLED (Default aus). Fail-Soft: Fehler/Timeout/
    // Schemaverstoss -> null -> ctx.context bleibt null -> systemPrompt byte-identisch
    // zum Bestand (assistantContextSection: `!call.context -> ""`). Bewusst KEIN Gate in
    // der outboundGates-Kette (Praezedenz diagnostic oben): es lehnt nie ab und haette die
    // reihenfolge-gepinnte Safety-Kette nur verbreitert. Position NACH der Kette ist
    // Pflicht - so entstehen keine Briefing-Token fuer einen Call, den Budget-, Nummern-
    // oder KYC-Gate ohnehin ablehnen (Regel 1).
    if (!ctx.context) {
      const briefed = await fetchPrecallBriefing({
        objective: ctx.objective,
        ownerNotes: b.briefing,
        constraints: b.constraints,
        to: ctx.to,
        tenantId: ctx.tenantId,
      });
      if (briefed) {
        ctx.context = briefed.context;
        ctx.mandate = ctx.mandate || briefed.mandate;
      }
    }

    // Thema A (Auftrag 2026-08-19): die Eroeffnungszeile des ElevenLabs-Wegs entsteht
    // BEI AUFTRAGSANNAHME - vorab erzeugt, fail-closed validiert, mit Rueckfall-Treppe
    // (src/elevenlabs/opening-line.js). NUR hinter dem EL-Schalter: die beiden
    // Telnyx-Zweige lesen die Zeile nie, eine Erzeugung dort waere bezahlter Muell.
    // Position NACH der Gate-Kette wie das Briefing (Regel 1: keine LLM-Token fuer
    // einen Anruf, den ein Gate ablehnt). Die Sprache kommt aus DERSELBEN Aufloesung,
    // die der Anrufstart benutzt (callLocaleOf, elevenlabs/outbound.js) - kein zweiter
    // Sprachweg, der still divergieren koennte. Geloggt werden nur Quelle und Laenge,
    // NIE der Text (er traegt Auftragsinhalt, Regel 4).
    let openingLine = null;
    if (config.voice.elevenLabsOutbound.enabled) {
      const { ownerName } = store.tenantContext(ctx.tenantId);
      const callLocale = callLocaleOf({
        store,
        config,
        call: { tenantId: ctx.tenantId, from: ctx.fromNumber, to: ctx.to },
        ownerName,
      });
      const opening = await fetchOpeningLine({
        objective: ctx.objective,
        tenantId: ctx.tenantId,
        locale: localeFor(callLocale.language),
      });
      openingLine = opening.line;
      console.log(`[opening-line] quelle=${opening.source} zeichen=${openingLine.length}`);
    }

    // Der /voice/outbound-Webhook rendert dank call.provider (P6a) automatisch TeXML
    // statt TwiML.
    const call = store.createCall({
      direction: "outbound",
      from: ctx.fromNumber,
      to: ctx.to,
      goal: ctx.objective,
      openingLine, // Thema A: null auf den Telnyx-Zweigen (s. Block oben)
      briefing: b.briefing,
      constraints: b.constraints,
      context: ctx.context,
      mandate: ctx.mandate, // P6: serverseitig normalisiert, nie roh aus dem Body
      language,
      maxDurationS: ctx.maxDur,
      requestedBy: ctx.requestedBy,
      tenantId: ctx.tenantId,
      provider: ctx.outboundProvider,
      reserveCents: ctx.reserveCents, // OUT-05 (F2)
      diagnostic, // P2b: serverseitig aufgeloest, nie roh aus dem Body
      // OC-P1: ebenfalls rein serverseitig - der Aufrufer nennt nur `to`, alles andere
      // (eigene Nummer, Schalter, Allowlist) entscheidet der Server. Kein Client-Flag.
      calleeIsOwner: calleeIsOwnerOfThisCall,
    });
    audit(
      "place_call",
      req,
      `to=${ctx.to} call=${call.id} provider=${ctx.outboundProvider} requestedBy=${ctx.requestedBy}`,
    );

    // AL-P13 (Sprosse 3 der Fakten-Leiter): die offenen Fragen des Briefings werden
    // beantwortet, WAEHREND das Telefon klingelt - 0 ms Gespraechslatenz. Bewusst KEIN
    // Gate in der outboundGates-Kette (Praezedenz diagnostic/Briefing): es lehnt nie ab
    // und haette die reihenfolge-gepinnte Safety-Kette nur verbreitert. Position NACH
    // jedem Gate: es entsteht kein Consult fuer einen Call, den ein Gate ohnehin ablehnt.
    emitOpeningConsult({ req, call, context: ctx.context, tenantId: ctx.tenantId });

    try {
      // EL-Anrufstart: der dritte Weg, an EXAKT derselben Stelle wie die beiden anderen -
      // HINTER der kompletten, unveraenderten Gate-Kette (KEIN zweiter Einstieg, Regel 1).
      // Der Weichenschalter steht Default aus; aus -> die beiden Telnyx-Zweige unten laufen
      // byte-identisch weiter. Der PROVIDER des Anrufs bleibt telnyx (die DID liegt dort,
      // ElevenLabs haengt per SIP-Trunk daran) - deshalb keine Provider-Abfrage, sondern
      // ein Engine-Schalter (s. src/elevenlabs/outbound.js).
      if (config.voice.elevenLabsOutbound.enabled) {
        await originateElevenLabsCall(call);
        // Regel 1 (Minuten-Achse): derselbe harte Max-Dauer-Cap wie im C-Telnyx-Zweig.
        // providerCallSid=null ist Absicht (es gibt keinen twilioSid); ohne callControlId
        // faellt hangUpAction auf null - der Cap beendet und bucht den Record, stoppt die
        // Ergebnis-Abholung UND loest seit 6da29ec (elevenLabsHangUpAction, s.
        // telephony/call-lifecycle.js) den Loeschversuch beim Anbieter aus (DELETE
        // /v1/convai/conversations/{id}, S1-2b: Kommentar korrigiert - er behauptete
        // vorher das Gegenteil). OB das die Leitung tatsaechlich kappt, ist weiterhin
        // NICHT belegt (s. convai.js#endConversation).
        armMaxDurationTimer(call, null);
        // C-Telnyx (P5): Call-Control-Origination HINTER der kompletten, unveraenderten Gate-
        // Kette (KEIN zweiter Einstieg, Regel 1). Verzweigt NUR bei aktivem Flag + Telnyx-
        // Provider; sonst TeXML byte-identisch. Flag Default aus -> Live-Pfad unveraendert bis P11.
      } else if (config.telnyx.telnyxAssistant.enabled && providerSupports(ctx.outboundProvider, CAPABILITY.AI_ASSISTANT)) {
        await originateAiAssistantCall({
          store,
          voiceControl,
          config,
          call,
          fromNumber: ctx.fromNumber,
          to: ctx.to,
          maxDur: ctx.maxDur,
        });
        // P6 (Regel 1, Minuten-Achse): harter Max-Dauer-Cap AUCH fuer C-Telnyx. originateAiAssistantCall
        // hat call.callControlId persistiert+gespeichert; terminateCappedCall liest sie beim Feuern
        // frisch und waehlt via hangUpAction den Call-Control-Hangup (endCallViaCallControl), NICHT
        // TeXML-endCall. providerCallSid=null ist Absicht (es gibt keinen twilioSid; die ID kommt
        // aus callControlId). KEIN realtime-Guard: ein C-Telnyx-Call laeuft NICHT ueber die
        // Realtime-Bridge (kein Media-Stream) -> dieser Timer ist neben time_limit_secs der
        // EINZIGE in-Prozess-Cap (fail-closed, Regel 1).
        armMaxDurationTimer(call, null);
      } else {
        const tw = await voiceControl(ctx.outboundProvider).originateCall({
          from: ctx.fromNumber,
          to: ctx.to,
          url: `${config.server.publicUrl}/voice/outbound?callId=${call.id}`,
          statusCallback: `${config.server.publicUrl}/voice/status?callId=${call.id}`,
          statusCallbackEvent: ["answered", "completed"],
          method: "POST",
          timeLimit: ctx.maxDur,
        });
        call.twilioSid = tw.sid;
        store.save();
        // Max-Dauer hart durchsetzen (Budget-Engine). Fuer den TeXML-Pfad der EINZIGE
        // verlaessliche Cap. Erst NACH erfolgreichem Originate armen (vorher gibt es
        // keinen providerCallSid).
        if (config.voice.voiceEngine !== VOICE_ENGINE.REALTIME) armMaxDurationTimer(call, tw.sid);
      }
      armReserveReleaseTimer(call); // OUT-05 (F2): Reserve-Backstop, BEIDE Pfade, nach erfolgreichem Originate
      res.json({
        ok: true,
        callId: call.id,
        twilioSid: call.twilioSid,
        status: "dialing",
        context_received: contextReceivedMeta(ctx.context, config), // I10
        // P2b: ehrliche Rueckmeldung, ob der Diagnose-Wunsch gewaehrt wurde. Eine still
        // verweigerte, datenschutzrelevante Anforderung ohne jede Beobachtbarkeit waere
        // ein eigener Defekt (Praezedenz: context_received/I10). NUR ein Boolean.
        diagnostic: call.diagnostic,
      });
    } catch (err) {
      // OUTBOUND-E2: der Grund steht als ERSTE Anweisung am Datensatz, VOR
      // terminateAndBillCall (recordStartRejectionReason oben, EIN Aufruf statt zwei
      // Anweisungen - haelt die gepinnte Zeilengrenze dieser Riesenfunktion, s.
      // eslint-legacy-exceptions.json). Dessen bill-Thunk laeuft ueber finishCall, und
      // finishCall liest call.failureReason beim Notification-Bau
      // (telephony/call-finish.js:203-217); stuende er spaeter, bliebe der Nutzertext
      // "<Ziel> (Status: failed)" - genau an der Stelle stumm, fuer die diese Etappe gebaut
      // ist (Muster: /voice/status ruft recordFailureReason ebenfalls VOR
      // terminateAndBillCall, routes/voice.js:542). Der catch umschliesst ALLE DREI
      // Engine-Zweige (:331/:345/:363) - damit bekommt auch eine Telnyx-Start-Ablehnung auf
      // dem TeXML-Weg erstmals einen Grund.
      const providerStatus = recordStartRejectionReason(store, call.id, err);
      // C5 (Struct-4): die eigentliche Luecke - bisher lief hier NIE finishCall (Settlement/
      // Notification fehlten komplett bei einem Dial-Fehlschlag), und releaseReserve wurde
      // manuell dupliziert obwohl finishCall es bereits idempotent selbst aufruft (S2,
      // reserveReleased-Guard in state-ops.js). Jetzt derselbe Gateway wie die anderen 4
      // Terminierungspfade; hangUp:null (kein Dial = kein Provider-Leg zum Auflegen).
      await terminateAndBillCall({
        persistEnd: () => store.endCallRecord(call.id, "failed"),
        hangUp: null,
        bill: billThunk(finishCall, store, call.id),
        callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
      });
      // Rohe Provider-Message NICHT an den Client (Secret-/Param-Leak, Regel 4/5):
      // Provider-SDK-Fehler koennen URL-/Auth-/Nummern-Fragmente tragen. Serverseitig
      // secret-frei loggen (wie die P0-Guards: err.message, nie config), dem Aufrufer
      // eine generische, stabile Meldung geben.
      console.error(
        `[place_call] originate fehlgeschlagen call=${call.id}:`,
        err?.message || String(err),
      );
      // Der Adapter haengt bei einer Provider-HTTP-Ablehnung err.providerStatus an
      // (secret-frei, oben gelesen). Liegt sie vor -> kategorisierte, provider-NEUTRALE
      // Meldung mit Statusklasse (502 Upstream), damit der Aufrufer den echten Grund
      // erkennt. C-P4: der frueher hier angehaengte Twilio-Trial-Hint ist mit dem Adapter
      // entfallen - er haette nur fuer einen Anbieter gegolten, den es nicht mehr gibt.
      // Kein Roh-Body/Key an den Client (Regel 4/5).
      const body = providerStatus
        ? {
            error: `Provider hat den Anruf abgelehnt (HTTP ${providerStatus}). Account-/Nummern-Konfiguration pruefen.`,
          }
        : { error: "Anruf konnte nicht gestartet werden." };
      res.status(providerStatus ? 502 : 500).json(body);
    }
  });

  // AL-P13: kurzer Long-Poll auf das naechste Consult-Ereignis. HINTER `internalOnly`
  // (Regel 3, keine neue Auth-Ausnahme), plus callVisibleTo wie
  // GET /api/calls/:id: fremder Call -> 404 (kein Existenz-Leck, NICHT 403). Fehlende
  // Faehigkeit -> ebenfalls 404: die Existenz des Kanals ist selbst eine Information.
  // Liefert NIE Transkript/Audio - nur Ereignis, Kennung und Fragen (Regel 5).
  //
  // KEIN req.on("close")-Abbruch: ein abgebrochener Host-Request darf den Slot NICHT
  // ueber das Socket-Ereignis freigeben (genau dort schliesst routes/mcp.js Transport
  // und Server, waehrend der Handler weiterlaeuft). Der Slot faellt im finally von
  // waitForEvent, spaetestens nach der Haltezeit.
  router.get("/api/calls/:id/consult", internalOnly, async (req, res) => {
    const call = store.getCall(req.params.id);
    const tenantId = requestTenant(req);
    if (!callVisibleTo(call, tenantId)) return res.status(404).json({ error: "not found" });
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return res.status(404).json({ error: "not found" });
    // AL-P14: der Zug des Clients ist der Beleg, dass eine Rueckfrage im Gespraech
    // ueberhaupt jemanden erreicht. Vor waitForEvent gebucht - es zaehlt die ABSICHT
    // des Clients, nicht der Ausgang des Polls. Ephemer, kein Persistenz-Pfad.
    store.noteConsultPoll(call.id);
    const event = await consultDelivery.waitForEvent({
      callId: call.id,
      tenantId: call.tenantId,
      afterEventId: typeof req.query.after === "string" ? req.query.after : null,
      signal: null,
    });
    res.json(event);
  });

  // AL-P13: Antwort einspeisen. Reihenfolge bindend (Safety vor Eingabefehler):
  // Tenant-Aufloesung -> Ownership -> Faehigkeit -> Validierung.
  // Die Antwort ist FREMDBESTIMMTER Text ueber einen SCHREIBENDEN Endpunkt und laeuft
  // deshalb durch DIESELBE validateAssistantContext-Kante wie das Briefing - eine
  // zweite, eigene Laengenpruefung waere eine zweite, schwaechere Tuer in den
  // Systemprompt. Verstoss -> 400, Antwort verworfen, Consult bleibt unbeantwortet.
  router.post("/api/calls/:id/consult/answer", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res); // REJECT -> 403 (Write-403, I-Kette)
    if (!tenantId) return;
    const call = store.getCall(req.params.id);
    if (!callVisibleTo(call, tenantId)) return res.status(404).json({ error: "not found" });
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return res
        .status(403)
        .json({ error: "Consult-Kanal ist fuer diesen Tenant nicht freigegeben." });
    const { event_id: eventId, answers } = req.body || {};
    // event_id ist Client-Freitext ueber einen authentifizierten Endpunkt. Format-
    // Pruefung VOR jeder Weiterverarbeitung (auch vor dem Audit-Log unten) - sonst
    // landet beliebiger Text im Forensik-Trail (Regel 4: keine Freitext-Audit-Zeile).
    if (!isConsultEventId(eventId))
      return res.status(400).json({ error: "event_id ist ungueltig" });
    const validated = validateAssistantContext({ key_facts: answers });
    if (validated.error || !validated.value)
      return res.status(400).json({ error: validated.error || "answers ist Pflicht" });
    // GQ-P2: die Offen-Frist-KONSTANTE kommt aus dem Consult-Modul (G22/EINE Quelle),
    // der DB-Zugriff bleibt am injizierten store (DIP) - anders als claude.js/der Shim ist
    // diese Route Factory-basiert und wird mit einem Store-Double getestet (P4); ein
    // direkter Aufruf von in-call.js's acceptConsultAnswer wuerde am Test-Double vorbei
    // immer den echten Singleton-Store treffen.
    const { outcome, mergedFacts } = store.answerConsult(call.id, {
      eventId,
      facts: validated.value.key_facts,
      nowMs: Date.now(),
      openMs: CONSULT_OPEN_MS,
    });
    audit(
      "consult_answered",
      req,
      `call=${call.id} event=${eventId} ergebnis=${outcome} fakten=${mergedFacts}`,
    );
    if (outcome !== CONSULT_ANSWER.ACCEPTED) return res.status(409).json({ error: outcome });
    res.json({ accepted: true, merged_facts: mergedFacts });
  });

  // Laufenden Anruf sauber abbrechen
  router.post("/api/calls/:id/cancel", internalOnly, async (req, res) => {
    const call = store.getCall(req.params.id);
    if (!callVisibleTo(call, requestTenant(req)))
      return res.status(404).json({ error: "not found" });
    if (call.status !== "active") return res.json({ status: call.status });
    const requestedBy = internalIdentity(req) || OWNER_ID; // L5: forensisch nachvollziehbar
    audit("cancel_call", req, `call=${call.id} requestedBy=${requestedBy}`);
    // S1-4 Fix (Owner-Auftrag 15.08.2026): hangUpAction() EINMAL ausgewertet (vorher
    // zweimal identisch aufgerufen, das erste Ergebnis nur als Boolean verworfen) -
    // providerHangUp ist zugleich der Telnyx-Thunk UND die Telnyx-Form-Erkennung.
    const providerHangUp = hangUpAction(voiceControl, call, call.twilioSid);
    // Die EL-FORM des Anrufs entscheidet die ehrliche Antwort weiter unten - NICHT, ob der
    // Beende-Versuch zufaellig zustandekam. elevenlabsConversationId kann waehrend der
    // Klingelphase noch fehlen (elevenlabs/outbound.js Modul-Kopf, ~40s gemessen); ein
    // cancel_call in diesem Fenster darf trotzdem nicht die kurze, unbedingte
    // "cancelled"-Antwort bekommen. config.voice.elevenLabsOutbound.enabled ist derselbe
    // Schalter, der in POST /api/calls die drei Origination-Zweige exklusiv verzweigt (kein
    // zweiter Wortlaut, G5): steht er an, lief jeder outbound Call ohne providerHangUp durch
    // GENAU diesen Zweig - unabhaengig davon, ob die Kennung schon zurueck ist.
    const isElevenLabsCall = !providerHangUp && config.voice.elevenLabsOutbound.enabled;
    const elHangUp = isElevenLabsCall ? elevenLabsHangUpAction(endActiveCall, call) : null;
    // F10 Runde 2 (G5): derselbe Terminierungspfad wie der Max-Dauer-Cap - erst auflegen
    // (awaited, provider-aware ueber call.provider - sonst endCall ueber den falschen
    // Anbieter), dann buchen (fire-and-forget).
    await terminateAndBillCall({
      persistEnd: () => store.endCallRecord(call.id, "cancelled"),
      // P6 (Check 5): dieselbe callControlId-/twilioSid-Auswahl wie terminateCappedCall (G5,
      // EINE Quelle) - EL-Calls fallen auf den Beende-Versuch (elHangUp, s.o.).
      hangUp: providerHangUp ?? elHangUp,
      bill: billThunk(finishCall, store, call.id),
      onHangUpError: (e) => console.error("[cancel]", e.message),
      callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
    });
    // S1-4 Fix: die ehrliche Antwortform gilt fuer JEDEN EL-Anruf (isElevenLabsCall), nicht
    // nur fuer die mit bereits angekommener Kennung - der Loeschversuch beim Anbieter ist
    // ohnehin NICHT belegt, die Leitung zu kappen (s. convai.js#endConversation).
    // "cancelled" behauptet auf diesem Pfad nur, was wahr ist (Datensatz storniert, Buchung
    // gestoppt), NICHT, dass die Leitung schon steht. hangup_attempted meldet zusaetzlich,
    // ob ueberhaupt ein Griff auf das Gespraech bestand (elHangUp truthy): fehlt die
    // Kennung noch (oder ist elevenLabsHangUpAction gar nicht verdrahtet, S1-5), sagt die
    // Antwort das ausdruecklich, statt einen Versuch zu behaupten, der nie stattfand. Der
    // Telnyx-Pfad (awaiteter, bestaetigter Hangup) bleibt bei der reinen Kurzantwort.
    if (isElevenLabsCall)
      return res.json({
        status: "cancelled",
        line_hangup_confirmed: false,
        max_line_s: ELEVENLABS_PROVIDER_MAX_DURATION_S,
        hangup_attempted: Boolean(elHangUp),
      });
    res.json({ status: "cancelled" });
  });

  return router;
}
