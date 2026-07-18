// ---- makeCallRoutes (Server-Slim-Decomposition) ---------------------------------
// Extrahierte Outbound-Call-Route-Gruppe (POST /api/calls, POST /api/calls/:id/cancel)
// als Factory mit Dependency-Injection - gleiches Muster wie makeReadRoutes/
// makeTenantWriteRoutes/makeBillingRoutes. Teil der server.js-Decomposition
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
// Hinter der bestehenden /api/*-Basic-Auth (server.js deckt /api/* ab), an
// unveraenderter Mount-Position (vor makeReadRoutes). normNum/PROVIDER (store/defaults)
// und isTrunkZeroFormatError/E164_FORMAT_ERROR (outbound-gates) kommen direkt aus ihrer
// Heimat (eine Quelle, G5 - wie globalCapEur in makeReadRoutes); die Laufzeit-Instanzen
// (Gate-Array, Timer, Terminierung, finishCall) und die request-tenant-Resolver werden
// injiziert (EINE Quelle, INV-7).
import { Router } from "express";
import { VOICE_ENGINE } from "../config.js";
import { normNum, PROVIDER } from "../store/defaults.js";
import { E164_FORMAT_ERROR, isTrunkZeroFormatError } from "../telephony/outbound-gates.js";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";

// I10 (call-quality Impl-1): additives Meta in der /api/calls-Erfolgsantwort - zeigt dem
// aufrufenden MCP-Client (place_call), WAS vom optionalen context tatsaechlich ankam.
// NUR bool/count, NIE der Kontext-Inhalt selbst (kein zweiter Transportweg fuer
// HINTERGRUND-Daten). active=false, wenn der Kanal komplett abgeschaltet ist
// (config.assistantContextEnabled aus - context ist dann IMMER null, s.o.).
function contextReceivedMeta(context, config) {
  return {
    active: config.tenancy.assistantContextEnabled,
    summary: !!context?.summary,
    key_facts_count: Array.isArray(context?.key_facts) ? context.key_facts.length : 0,
    recipient_relationship: !!context?.recipient_relationship,
    desired_outcome: !!context?.desired_outcome,
  };
}

// deps: siehe Modul-Doc. arm = { armMaxDurationTimer, armReserveReleaseTimer } aus der EINEN
// lifecycle-Instanz (Cap-/Reserve-Backstop, INV-7); finishCall = callFinish.finishCall (bare,
// EINE Referenz wie in call-lifecycle.js); tenant = { requestTenant, tenantOwnsCall }.
export function makeCallRoutes({
  store,
  config,
  audit,
  outboundGates,
  voiceControl,
  originateAiAssistantCall,
  terminateAndBillCall,
  hangUpAction,
  billThunk,
  finishCall,
  arm: { armMaxDurationTimer, armReserveReleaseTimer },
  tenant: { requestTenant, tenantOwnsCall },
  internalIdentity,
  OWNER_ID,
}) {
  const router = Router();

  // Outbound-Call starten (Vertrag laut Brief: objective/briefing/constraints/...)
  router.post("/api/calls", async (req, res) => {
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
        if (denial.audit) audit(denial.audit.event, req, denial.audit.detail);
        return res.status(denial.status).json(denial.body);
      }
    }

    // Ab hier ist ctx vollstaendig durch die Gate-Kette befuellt. KRITISCH: ctx.to ist die von
    // normalize_target aufgeloeste Nummer - die lokale `to` bleibt roh und wird ab hier NICHT
    // mehr gelesen.
    const language = store.resolveCallLanguage({ tenantId: ctx.tenantId, numberRecord: ctx.numberRecord });
    // Der /voice/outbound-Webhook rendert dank call.provider (P6a) automatisch TeXML
    // statt TwiML.
    const call = store.createCall({
      direction: "outbound",
      from: ctx.fromNumber,
      to: ctx.to,
      goal: ctx.objective,
      briefing: b.briefing,
      constraints: b.constraints,
      context: ctx.context,
      language,
      maxDurationS: ctx.maxDur,
      requestedBy: ctx.requestedBy,
      tenantId: ctx.tenantId,
      provider: ctx.outboundProvider,
      reserveCents: ctx.reserveCents, // OUT-05 (F2)
    });
    audit(
      "place_call",
      req,
      `to=${ctx.to} call=${call.id} provider=${ctx.outboundProvider} requestedBy=${ctx.requestedBy}`,
    );

    try {
      // C-Telnyx (P5): Call-Control-Origination HINTER der kompletten, unveraenderten Gate-
      // Kette (KEIN zweiter Einstieg, Regel 1). Verzweigt NUR bei aktivem Flag + Telnyx-
      // Provider; sonst TeXML byte-identisch. Flag Default aus -> Live-Pfad unveraendert bis P11.
      if (config.telnyx.telnyxAssistant.enabled && providerSupports(ctx.outboundProvider, CAPABILITY.AI_ASSISTANT)) {
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
        // Max-Dauer hart durchsetzen (Budget-Engine). Fuer Twilio redundant zum
        // timeLimit-Param, fuer Telnyx (TeXML-Pfad) der einzige verlaessliche Cap. Erst NACH
        // erfolgreichem Originate armen (vorher gibt es keinen providerCallSid).
        if (config.voice.voiceEngine !== VOICE_ENGINE.REALTIME) armMaxDurationTimer(call, tw.sid);
      }
      armReserveReleaseTimer(call); // OUT-05 (F2): Reserve-Backstop, BEIDE Pfade, nach erfolgreichem Originate
      res.json({
        ok: true,
        callId: call.id,
        twilioSid: call.twilioSid,
        status: "dialing",
        context_received: contextReceivedMeta(ctx.context, config), // I10
      });
    } catch (err) {
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
      // (secret-frei). Liegt sie vor -> kategorisierte, provider-NEUTRALE Meldung mit
      // Statusklasse (502 Upstream), damit der Aufrufer den echten Grund erkennt statt
      // einer irrefuehrenden Twilio-Meldung bei einem Telnyx-Call. Der Twilio-Trial-Hint
      // nur bei Provider Twilio. Kein Roh-Body/Key an den Client (Regel 4/5).
      const providerStatus = err?.providerStatus;
      const body = providerStatus
        ? {
            error: `Provider hat den Anruf abgelehnt (HTTP ${providerStatus}). Account-/Nummern-Konfiguration pruefen.`,
          }
        : { error: "Anruf konnte nicht gestartet werden." };
      if (ctx.outboundProvider === PROVIDER.TWILIO) {
        body.hint = "Twilio-Trial: Die Zielnummer muss unter 'Verified Caller IDs' verifiziert sein.";
      }
      res.status(providerStatus ? 502 : 500).json(body);
    }
  });

  // Laufenden Anruf sauber abbrechen
  router.post("/api/calls/:id/cancel", async (req, res) => {
    const call = store.getCall(req.params.id);
    // L5: fremder Tenant -> 404 (kein Existenz-Leck, NICHT 403). Hinter dem Flag:
    // aus -> ungefiltert wie heute (byte-identisch, auch fuer Calls ohne tenantId).
    // Nutzt I5's gemeinsamen tenantOwnsCall-Helper (eine Quelle der Ownership-Regel,
    // wie GET /api/calls/:id); !call short-circuitet vor dem tenantOwnsCall-Zugriff.
    if (!call || (config.tenancy.multiTenant && !tenantOwnsCall(call, requestTenant(req))))
      return res.status(404).json({ error: "not found" });
    if (call.status !== "active") return res.json({ status: call.status });
    const requestedBy = internalIdentity(req) || OWNER_ID; // L5: forensisch nachvollziehbar
    audit("cancel_call", req, `call=${call.id} requestedBy=${requestedBy}`);
    // F10 Runde 2 (G5): derselbe Terminierungspfad wie der Max-Dauer-Cap - erst auflegen
    // (awaited, provider-aware ueber call.provider - sonst Twilio-endCall auf einem
    // Telnyx-Call), dann buchen (fire-and-forget).
    await terminateAndBillCall({
      persistEnd: () => store.endCallRecord(call.id, "cancelled"),
      // P6 (Check 5): dieselbe callControlId-/twilioSid-Auswahl wie terminateCappedCall (G5,
      // EINE Quelle) - cancel_call eines C-Telnyx-Calls trifft den Call-Control-Hangup.
      hangUp: hangUpAction(voiceControl, call, call.twilioSid),
      bill: billThunk(finishCall, store, call.id),
      onHangUpError: (e) => console.error("[cancel]", e.message),
      callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
    });
    res.json({ status: "cancelled" });
  });

  return router;
}
