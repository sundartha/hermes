// Call-Control-Event-Ingest (PLAN-TELNYX-AI-ASSISTANT.md, P4.5): signaturgeprueft
// (Ed25519 via /voice-Mount) laeuft hier die event-getriebene Zustandsmaschine.
// answered -> deterministischer Opening-Speak-Node (Offenlegung + Anliegen, Regel 2/R5);
// dessen speak.ended -> ai_assistant_start (Regel 2, NIE davor); hangup -> Settlement
// finishCall (Regel 1, verhindert Reserve-Leak/gesperrtes Tenant-Budget). Factory+DI wie
// makeTelnyxLlmShim: alle Seiteneffekt-Deps injiziert -> Zustandsmaschine offline mit
// Spies testbar.
import { parseCallControlEvent, CALL_CONTROL_EVENT } from "./telephony/adapters/telnyx/call-control-events.js";
import { eventEnvelope } from "./telephony/adapters/telnyx/speak-events.js";

// OBS-2: Log-Hygiene-Bound fuer rohe Telnyx-Protokoll-Token (event_type/status). Interner
// Log-Volumen-Schutz, KEIN Operator-Knopf -> modul-lokal (wie errors.js ERROR_DETAIL_MAX_LEN),
// NICHT config.js (G35). Der /voice/call-control-Mount ist Ed25519-signaturgeprueft, der Body
// also provider-authentisch; der Bound ist reine Defense-in-Depth gegen ein unerwartet grosses Feld.
const EVENT_TOKEN_MAX_LEN = 64;

// Roher Telnyx-Protokoll-Token PII-frei fuer den Log: null/undefined -> "none", sonst
// String-coerced + gekuerzt. event_type/status sind Lifecycle-Enums (kein Freitext/PII).
function rawToken(value) {
  return value == null ? "none" : String(value).slice(0, EVENT_TOKEN_MAX_LEN);
}

// OBS-2: EIN roher Protokoll-Log pro Event (call.id = interne ID, kein PII). Macht die real
// gelieferten event_type/status-Formen (alle "LIVE UNBESTAETIGT") sichtbar, damit P1a-FIX die
// echte Token-Form kennt - NICHT auf eine completed/failed-Allowlist geklemmt (sonst verschluckt
// die Beobachtung genau den Token, den der speak.ended-Fix braucht). eventEnvelope hebt die
// {data:{...}}-Huelle ab (G5, dieselbe Quelle wie call-control-events.js).
function logEventReceived(callId, body) {
  const env = eventEnvelope(body);
  console.log(
    `[voice/call-control] event empfangen (call=${callId}) event_type=${rawToken(env?.event_type)} status=${rawToken(env?.payload?.status)}`,
  );
}

export function makeCallControlIngest({
  store,
  voiceControl,
  finishCall,
  openingText,
  localeFor,
  reattachActiveCall,
  watchdog,
}) {
  // Regel 2 + R5 (stab-p8): der deterministische Erst-Speak spricht den vollen Opening-Text
  // (openingText = Offenlegung ZUERST + Anliegens-Bruecke) - DIESELBE eine Quelle wie der
  // Budget-Pfad (/voice/outbound). So deckt sich das Gesprochene mit der systemPrompt-Annahme
  // ("Anliegen wurde bereits gesagt"); der Assistant erbt kein ungesprochenes Anliegen mehr.
  async function onAnswered(call, callControlId) {
    store.markAnswered(call.id); // answeredAt -> voiceMinutesOf (Abrechnung), Muster /voice/outbound
    await voiceControl(call.provider).speak({
      callControlId,
      // Offenlegung bleibt byte-identisch der erste Satz (openingText praefixt sie), NIE
      // Modell-Ermessen; das Anliegen folgt LLM-frei (leeres goal -> reine Offenlegung).
      text: openingText(call),
      voiceProfile: localeFor(call.language).voiceProfile,
    });
    console.log(`[voice/call-control] answered (call=${call.id}) -> Opening-Speak abgesetzt`);
  }
  // Regel 2: ai_assistant_start NUR als Reaktion auf das speak.ended des Disclosure-Nodes.
  async function onSpeakEnded(call, callControlId) {
    if (!call.assistantId) {
      // assistantId persistiert P5 bei der Origination; fehlt sie -> fail-safe skip
      // (kein Crash/Orphan; Disclosure + Settlement sind davon unabhaengig).
      console.warn(`[voice/call-control] speak.ended ohne assistantId (call=${call.id}) -> kein Assistant-Start`);
      return;
    }
    // Auth des Shims laeuft ueber das statische Telnyx-Integration-Secret (E2); ai_assistant_start
    // braucht keinen per-Call-Auth-Param (Korrelation laeuft ueber call_control_id, E1).
    await voiceControl(call.provider).startAssistant({ callControlId, assistantId: call.assistantId });
    console.log(`[voice/call-control] speak.ended (call=${call.id}) -> ai_assistant_start abgesetzt`);
    watchdog.arm(call.id); // stab-p9: Dead-Air-Wache starten (ai_assistant_start ist raus)
  }
  // Regel 2: die Pflicht-Offenlegung ist (Azure-NTTS-Stoerung) fehlgeschlagen -> ai_assistant_start
  // bleibt fail-safe aus, sonst spricht die KI, ohne dass die Offenlegung je zu hoeren war.
  // Kein Crash/Orphan: Settlement bei hangup laeuft unabhaengig weiter (wie oben).
  function onSpeakFailed(call) {
    console.warn(`[voice/call-control] Speak-Offenlegung fehlgeschlagen (call=${call.id}) -> kein Assistant-Start`);
  }
  // Regel 1: Terminal-Settlement (Ist-Minuten buchen + Reserve freigeben), idempotent
  // ueber billedAt/reserveReleased. Spiegelt den /voice/status-completed-Pfad; finishCall
  // ruft releaseReserve intern. Kein Timer-Handle-Clear noetig (billedAt/status!=active
  // machen ausstehende Max-Dauer-/Reserve-Timer zum No-op, Bestandsmuster).
  async function onHangup(call) {
    watchdog.clear(call.id); // stab-p9: Wache stoppen (Call terminal, egal welcher Grund)
    if (call.status === "active") store.endCallRecord(call.id, "completed");
    await finishCall(store.getCall(call.id));
    console.log(`[voice/call-control] hangup (call=${call.id}) -> Settlement finishCall`);
  }

  // A6 (stab-p10): Read-through-Rehydrate. Kennt der Prozess-Spiegel den Call nicht
  // (Deploy-/Instanzwechsel liess die aktive DB-Zeile aus diesem Spiegel fallen), wird er
  // RLS-sauber aus dem Store nachgeladen - inkl. tenantId (I8) und aller vom Turn-/Gate-Fluss
  // benoetigten Felder (rowToCall) - statt das Live-Gespraech zu verwerfen. EXAKT derselbe
  // reattachActiveCall-Seam wie /voice/turn|outbound|status (S2/G5): auch hier Restzeit-
  // Klassifikation + Max-Dauer-Cap-Rearm (Regel 1). Normalfall (Call auf derselben Instanz):
  // getCall trifft -> reattach wird NIE gerufen -> byte-identisch zum Bestand.
  // null-Rueckgabe = wirklich unbekannt ODER Ueber-Zeit bereits terminalisiert+gebucht
  // -> der Aufrufer ignoriert fail-closed (kein Reanimieren).
  async function resolveActiveCall(callId) {
    const known = store.getCall(callId);
    if (known) return known;
    const { call } = await reattachActiveCall(callId);
    return call;
  }

  return async function handleCallControlEvent(req, res) {
    res.sendStatus(200); // sofort ack (Telnyx retryt bei non-2xx); Actions/Settlement danach
    try {
      const call = await resolveActiveCall(req.query.callId || "");
      if (!call) {
        // unbekannter/fremder callId -> still 200, kein Existenz-Leck (Muster /voice/status).
        // Regel 4: nur der Grund-Token, NIE der rohe (Caller-kontrollierte) Query-Wert.
        console.warn("[voice/call-control] Event fuer unbekannten callId ignoriert (reason=unknown_call)");
        return;
      }
      const { eventType, callControlId } = parseCallControlEvent(req.body);
      logEventReceived(call.id, req.body); // OBS-2: roher event_type+status pro Event (PII-frei)
      if (eventType === CALL_CONTROL_EVENT.ANSWERED) return void (await onAnswered(call, callControlId));
      if (eventType === CALL_CONTROL_EVENT.SPEAK_ENDED) return void (await onSpeakEnded(call, callControlId));
      if (eventType === CALL_CONTROL_EVENT.SPEAK_FAILED) return void onSpeakFailed(call);
      if (eventType === CALL_CONTROL_EVENT.HANGUP) return void (await onHangup(call));
      // unbekannt/sonstiges -> keine Wirkung (200 bereits gesendet)
    } catch (err) {
      // 200 ist raus; Fehler nur secret-frei loggen (kein Roh-Body/Key), keine unhandled rejection.
      console.error("[voice/call-control]", err.message);
    }
  };
}
