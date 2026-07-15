// Call-Control-Event-Ingest (PLAN-TELNYX-AI-ASSISTANT.md, P4.5): signaturgeprueft
// (Ed25519 via /voice-Mount) laeuft hier die event-getriebene Zustandsmaschine.
// answered -> deterministischer Opening-Speak-Node (Offenlegung + Anliegen, Regel 2/R5);
// dessen speak.ended -> ai_assistant_start (Regel 2, NIE davor); hangup -> Settlement
// finishCall (Regel 1, verhindert Reserve-Leak/gesperrtes Tenant-Budget). Factory+DI wie
// makeTelnyxLlmShim: alle Seiteneffekt-Deps injiziert -> Zustandsmaschine offline mit
// Spies testbar.
import { parseCallControlEvent, CALL_CONTROL_EVENT } from "./telephony/adapters/telnyx/call-control-events.js";
import { eventEnvelope } from "./telephony/adapters/telnyx/speak-events.js";
import { assistantVoiceConfigured } from "./telephony/adapters/telnyx/voice.js";
import { defaultSetTimer, MS_PER_SECOND } from "./utils/timer.js";
import { terminateAndBillCall } from "./telephony/call-termination.js";

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
  config,
  setTimer = defaultSetTimer,
  clearTimer = clearTimeout,
}) {
  // afix-p1 (Fallback-Kette, Regel 2 - das Opening darf NIE ausfallen): pro Call genau EIN
  // Retry mit der Bestands-Stimme (Azure), wenn der Opening-Speak mit der Assistant-Stimme
  // scheitert - synchron (Adapter wirft, z.B. HTTP 400) ODER per Event (call.speak.failed).
  // Ephemerer In-Memory-State im Closure (Muster: Watchdog-Map), aufgeraeumt in onHangup.
  // Endlosschleife speak.failed -> retry -> speak.failed ist damit ausgeschlossen.
  // BEWUSST: Prozess-Restart mid-Call verliert den Merker -> hoechstens EIN weiterer Retry,
  // im schlimmsten Fall heutiges Verhalten (kein Retry). Kein Sweep noetig (onHangup raeumt).
  const openingRetryUsed = new Set();

  // afix-timeout (Befund 2): Telnyx' Speak-Command kann verstummen, OHNE je ein
  // call.speak.started/ended/failed zu emittieren (Live-Test Call 2/3). Ohne Terminal-Event
  // haengt der Opening-Speak-Node bis zum manuellen Hangup in Stille. Pro Call EIN Watchdog-Timer
  // (Muster telnyx-conversation-watchdog.js states-Map): feuert er, wird das fehlende Event wie
  // ein call.speak.failed behandelt (dieselbe onSpeakFailed-Funktion, G5). Aufgeraeumt bei
  // speak.ended/failed/hangup (idempotent). Bewusst NICHT im Watchdog: der terminiert den Call
  // NACH ai_assistant_start; dieser Timeout greift DAVOR und terminiert NICHT, sondern loest
  // Retry-oder-Fail-Safe aus (S3/S4-Vermeidung: getrennte Ein-Zweck-States statt Mehrzweck).
  const openingSpeakTimers = new Map(); // callId -> Timer-Handle

  // Timer fuer diesen Call loeschen, falls einer laeuft (idempotent, Muster clearNamedTimer im
  // Watchdog). Nach dem Feuern ist der Map-Eintrag ggf. schon weg; das get/if-Guard macht den
  // Aufruf in jedem Pfad (echtes Event ODER Selbst-Timeout) zum sicheren No-op.
  function clearOpeningSpeakTimer(callId) {
    const timer = openingSpeakTimers.get(callId);
    if (!timer) return;
    clearTimer(timer);
    openingSpeakTimers.delete(callId);
  }

  // Nach abgesetztem Opening-Speak den Watchdog armieren: kommt binnen
  // config.telnyxOpeningSpeakTimeoutS Sekunden KEIN speak.ended/speak.failed, wird onSpeakFailed
  // wie bei einem echten Fehler ausgeloest (G5, kein zweiter Fehlerpfad). Vorher ein evtl.
  // laufender Timer geloescht (nie zwei Timer je Call, Muster restartDeadAirTimer). Der
  // Timer-Callback laeuft ausserhalb des Handler-try/catch -> Rejection secret-frei abfangen
  // (keine unhandled rejection, Muster terminateOnce).
  function armOpeningSpeakTimeout(call, callControlId) {
    clearOpeningSpeakTimer(call.id);
    const timer = setTimer(() => {
      Promise.resolve(onSpeakFailed(call, callControlId)).catch((err) =>
        console.error("[voice/call-control]", err.message),
      );
    }, config.telnyxOpeningSpeakTimeoutS * MS_PER_SECOND);
    openingSpeakTimers.set(call.id, timer);
  }

  // Review-Blocker Runde 3 (d): der Ingest reicht useAssistantVoice:true IMMER an sendOpeningSpeak
  // durch - die Fallback-Entscheidung "Config fehlt -> Azure" faellt erst im Adapter
  // (speakVoiceFields). Ohne dieses Gate wuerde ein Speak-Fehler auch OHNE ElevenLabs-Config
  // ein Retry verbrauchen, obwohl der erste Versuch mangels Config bereits Azure gesprochen
  // hat - ein zweiter Azure-Speak waere KEIN heutiges Verhalten mehr (Spec (a): "Config
  // unvollstaendig -> direkt Azure, kein Retry noetig"). assistantVoiceConfigured() ist eine
  // reine Funktion von config (kein IO, kein Mid-Call-Wechsel moeglich) - direktes Gaten statt
  // eines zusaetzlichen pro-Call-Merkers haelt den State minimal (kein weiterer Cleanup-Pfad
  // in onHangup noetig).
  //
  // Verbraucht das eine Retry-Token des Calls (Nebeneffekt im Namen, N7): true = Retry darf
  // laufen, false = Config fehlt ODER Token bereits verbraucht -> Fail-Safe (d), byte-identisch
  // zum Bestand ohne Assistant-Stimme.
  function consumeOpeningRetry(callId) {
    if (!assistantVoiceConfigured()) return false;
    if (openingRetryUsed.has(callId)) return false;
    openingRetryUsed.add(callId);
    return true;
  }

  // Observability (PFLICHT): ohne diesen Marker ist "Azure statt ElevenLabs" im Live-Betrieb
  // unsichtbar. PII-frei (interne call.id, nie ccid/Secrets/Text).
  function logOpeningVoice(call, useAssistantVoice) {
    if (useAssistantVoice && assistantVoiceConfigured()) {
      console.log(`[voice/call-control] opening_voice=elevenlabs (call=${call.id})`);
      return;
    }
    const reason = useAssistantVoice ? "config_missing" : "retry_after_failure";
    console.log(`[voice/call-control] opening_voice=azure reason=${reason} (call=${call.id})`);
  }

  // Der EINE Opening-Speak (kein zweiter Aufrufpfad, G5): Text/Stimme/Provider identisch,
  // nur die Stimmen-Wahl variiert.
  async function sendOpeningSpeak({ call, callControlId, useAssistantVoice }) {
    logOpeningVoice(call, useAssistantVoice);
    await voiceControl(call.provider).speak({
      callControlId,
      // Offenlegung bleibt byte-identisch der erste Satz (openingText praefixt sie), NIE
      // Modell-Ermessen; das Anliegen folgt LLM-frei (leeres goal -> reine Offenlegung).
      text: openingText(call),
      voiceProfile: localeFor(call.language).voiceProfile,
      useAssistantVoice,
    });
  }

  // Regel 2 + R5 (stab-p8): der deterministische Erst-Speak spricht den vollen Opening-Text
  // (openingText = Offenlegung ZUERST + Anliegens-Bruecke) - DIESELBE eine Quelle wie der
  // Budget-Pfad (/voice/outbound). So deckt sich das Gesprochene mit der systemPrompt-Annahme
  // ("Anliegen wurde bereits gesagt"); der Assistant erbt kein ungesprochenes Anliegen mehr.
  async function onAnswered(call, callControlId) {
    store.markAnswered(call.id); // answeredAt -> voiceMinutesOf (Abrechnung), Muster /voice/outbound
    try {
      await sendOpeningSpeak({ call, callControlId, useAssistantVoice: true });
    } catch (err) {
      // (b) Synchroner Fehler (z.B. 400 auf die ElevenLabs-Voice) -> genau EIN Retry mit der
      // Bestands-Stimme. Ist das Token schon verbraucht, faellt der Fehler an den
      // Handler-Catch durch (kein startAssistant, heutiger Fail-Safe = (d)).
      if (!consumeOpeningRetry(call.id)) throw err;
      console.warn(`[voice/call-control] Opening-Speak fehlgeschlagen (call=${call.id}) reason=speak_error -> Retry mit Bestands-Stimme`);
      await sendOpeningSpeak({ call, callControlId, useAssistantVoice: false });
    }
    console.log(`[voice/call-control] answered (call=${call.id}) -> Opening-Speak abgesetzt`);
    armOpeningSpeakTimeout(call, callControlId); // afix-timeout: fehlt speak.ended/failed -> onSpeakFailed
  }
  // Regel 2: ai_assistant_start NUR als Reaktion auf das speak.ended des Disclosure-Nodes.
  async function onSpeakEnded(call, callControlId) {
    clearOpeningSpeakTimer(call.id); // afix-timeout: echtes Terminal-Event kam -> Watchdog aus
    if (!call.assistantId) {
      // assistantId persistiert P5 bei der Origination; fehlt sie -> fail-safe skip
      // (kein Crash/Orphan; Disclosure + Settlement sind davon unabhaengig).
      console.warn(`[voice/call-control] speak.ended ohne assistantId (call=${call.id}) -> kein Assistant-Start`);
      return;
    }
    // Auth des Shims laeuft ueber das statische Telnyx-Integration-Secret (E2); ai_assistant_start
    // braucht keinen per-Call-Auth-Param (Korrelation laeuft ueber call_control_id, E1).
    await voiceControl(call.provider).startAssistant({
      callControlId,
      assistantId: call.assistantId,
      // afix-p2 (R2): der per-Call-STT-Sprach-Hint gewinnt ueber das Assistant-Objekt (dort steht
      // "multi" = KEIN Hint). Neutrale Sprache rein, Mapping auf den Provider-Hint im Adapter.
      language: call.language,
    });
    console.log(`[voice/call-control] speak.ended (call=${call.id}) -> ai_assistant_start abgesetzt`);
    watchdog.arm(call.id); // stab-p9: Dead-Air-Wache starten (ai_assistant_start ist raus)
  }
  // (c) Die Offenlegung ist per EVENT gescheitert -> genau EIN Retry mit der Bestands-Stimme.
  // (d) Ist das Retry-Token verbraucht (oder fehlt die callControlId), greift der HEUTIGE
  // Fail-Safe unveraendert: ai_assistant_start bleibt aus, sonst spraeche die KI, ohne dass
  // die Offenlegung je zu hoeren war (Regel 2). Kein Crash/Orphan: das Settlement bei hangup
  // laeuft unabhaengig weiter.
  async function onSpeakFailed(call, callControlId) {
    clearOpeningSpeakTimer(call.id); // afix-timeout: idempotent - egal ob echtes Event oder Selbst-Timeout
    // AFIX-TIMEOUT-STALE-CALL (Review-Blocker Runde 3): der Timer-Callback in
    // armOpeningSpeakTimeout haelt den call-Objektverweis vom Arm-Zeitpunkt fest. Wurde der Call
    // zwischenzeitlich ueber einen ANDEREN Pfad beendet (/api/calls/:id/cancel,
    // terminateCappedCall bei Max-Dauer - beide loesen kein Event in diesem Modul aus, solange
    // Telnyx' eigenes hangup-Webhook ebenfalls ausbleibt), wuerde der Timer sonst trotzdem
    // feuern und per Retry-Zweig einen Speak-Befehl an einen bereits beendeten Call schicken.
    // Frischer Store-Stand + Statuspruefung VOR jeder Wirkung (Muster onHangup/
    // terminateViaCallControl: "Frischer Store-Stand pro Aufruf"); no-op bei nicht-aktivem Call.
    const freshCall = store.getCall(call.id);
    if (!freshCall || freshCall.status !== "active") {
      console.warn(`[voice/call-control] Speak-Offenlegung-Timeout fuer bereits beendeten Call ignoriert (call=${call.id})`);
      return;
    }
    if (callControlId && consumeOpeningRetry(call.id)) {
      console.warn(`[voice/call-control] Speak-Offenlegung fehlgeschlagen (call=${call.id}) -> Retry mit Bestands-Stimme`);
      await sendOpeningSpeak({ call, callControlId, useAssistantVoice: false });
      // afix-timeout (Review-Blocker Runde 1): auch der Retry-Leg kann verstummen, OHNE je ein
      // Terminal-Event zu senden (identisches Symptom wie der Erst-Speak) - ohne erneutes
      // Armieren haengt der Call dann wieder unbegrenzt in Stille, diesmal ungeschuetzt bis zum
      // harten maxCallDurationS-Cap. consumeOpeningRetry() ist bereits verbraucht (oben), ein
      // zweites Feuern dieses Timers laeuft in onSpeakFailed also direkt in den Fail-Safe-Zweig
      // (kein Endlos-Retry).
      // AFIX-TIMEOUT-RETRY-RACE (Review-Blocker Runde 4): der await oben kann von einem
      // parallelen Hangup (echtes Telnyx-Webhook, /api/calls/:id/cancel, maxCallDurationS-Cap)
      // ueberholt werden - derselbe frische Status-Check wie am Funktionsanfang, sonst wird ein
      // Timer fuer einen inzwischen beendeten Call neu armiert.
      if (store.getCall(call.id)?.status === "active") armOpeningSpeakTimeout(call, callControlId);
      return;
    }
    console.warn(`[voice/call-control] Speak-Offenlegung fehlgeschlagen (call=${call.id}) -> kein Assistant-Start`);
  }
  // Regel 1: Terminal-Settlement (Ist-Minuten buchen + Reserve freigeben), idempotent
  // ueber billedAt/reserveReleased. Spiegelt den /voice/status-completed-Pfad; finishCall
  // ruft releaseReserve intern. Kein Timer-Handle-Clear noetig (billedAt/status!=active
  // machen ausstehende Max-Dauer-/Reserve-Timer zum No-op, Bestandsmuster).
  async function onHangup(call) {
    openingRetryUsed.delete(call.id); // afix-p1: Retry-Token freigeben (Call terminal)
    clearOpeningSpeakTimer(call.id); // afix-timeout: Opening-Speak-Watchdog stoppen (Call terminal)
    watchdog.clear(call.id); // stab-p9: Wache stoppen (Call terminal, egal welcher Grund)
    // C5 (Struct-4): Settlement-Gateway statt manuellem endCallRecord+finishCall-Paar (G5, eine
    // Quelle mit /voice/status + place_call-catch). hangUp:null: Telnyx hat den Call bereits
    // beendet (dieses Event IST der Hangup).
    await terminateAndBillCall({
      persistEnd: () => {
        if (call.status === "active") store.endCallRecord(call.id, "completed");
      },
      hangUp: null,
      bill: () => finishCall(store.getCall(call.id)),
    });
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
      if (eventType === CALL_CONTROL_EVENT.SPEAK_FAILED) return void (await onSpeakFailed(call, callControlId));
      if (eventType === CALL_CONTROL_EVENT.HANGUP) return void (await onHangup(call));
      // unbekannt/sonstiges -> keine Wirkung (200 bereits gesendet)
    } catch (err) {
      // 200 ist raus; Fehler nur secret-frei loggen (kein Roh-Body/Key), keine unhandled rejection.
      console.error("[voice/call-control]", err.message);
    }
  };
}
