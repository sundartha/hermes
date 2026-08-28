// F10 Runde 2 (S1/G5), C5 (Struct-4): der EINE Terminierungspfad, den JEDER Beender eines
// aktiven Calls IN DER BUDGET-ENGINE durchlaeuft - fuenf Ausloeser: Max-Dauer-Cap-Timer
// (terminateCappedCall), cancel_call, place_call-Dial-Fehlschlag, /voice/status und der
// Telnyx-onHangup - Reihenfolge fest: erst persistieren, dann den Provider-
// Leg auflegen (awaited), ERST DANACH billing/summary/SMS anstossen (fire-and-forget). Die
// umgekehrte Reihenfolge hielte den Anruf beim Provider technisch live, waehrend die
// Buchungskette (echter LLM-Roundtrip in summarizeCall ueber src/llm.js mit EIGENEM
// Retry-Budget aus config.llm.summaryTimeoutMs - nicht dem Sprechpfad-Timeout -, danach
// der SMS-Versand) laeuft - Verstoss gegen den harten Max-Dauer-Cap (Absolute
// Regel 1, CLAUDE.md). Reine Ablauf-Orchestrierung: alle I/O-Effekte kommen als bereits
// gebundene Thunks rein (persistEnd/hangUp/bill), keine Abhaengigkeit auf store/
// voiceControl/finishCall aus server.js -> offline ohne Server/Store/Netz unit-
// testbar (Muster sms-summary.js).
//
// Die REALTIME-Engine (bridge.js) terminalisiert NICHT ueber diesen Weg: ihr finalize()
// beendet den Call idempotent (closed-Guard) via store.endCallRecord + onCallEnded (in Prod
// = callFinish.finishCall, gebucht genau einmal), NICHT ueber terminateAndBillCall. Beide
// Wege buchen heute korrekt genau einmal - dieser Helfer ist der Budget-Engine-Pfad.
//
// hangUp ist optional (null/undefined), wenn (noch) kein Provider-Call-Sid existiert -
// dann wird der Hangup-Versuch uebersprungen, persistiert+gebucht wird trotzdem.
// Ein hangUp-Fehler ist best-effort: onHangUpError entscheidet je Aufrufer, ob/wie
// geloggt wird (Bestandsverhalten bleibt je Aufrufer erhalten - der Cap-Timer schluckt
// bisher still, cancel_call loggt "[cancel]"). bill wird NICHT awaited (fire-and-
// forget): der Aufrufer wartet nicht auf Buchung/Summary/SMS, nur auf den Hangup.
//
// C5 (Struct-4, G31/G27): bill (Settlement) ist Pflicht - erzwingt strukturell, dass JEDER
// Terminierungspfad die volle Buchungs-/Notification-/SMS-Kette durchlaeuft, statt sie an
// einer neuen Call-Site zu vergessen (der urspruengliche C5-Bug: der place_call-catch rief
// finishCall nie). Wirft VOR jedem Seiteneffekt (fail-fast, kein halb-terminierter Call).
//
// P8 (Review-Blocker S1, Beobachtbarkeit): bill() bleibt bewusst fire-and-forget (Regel 1 -
// der Max-Dauer-Cap-Timer darf NICHT auf die Buchungskette warten). Ohne eigenes .catch
// landete eine Rejection (z.B. store.markBilled/store.save schlaegt bei einem PG-IO-Fehler
// fehl) NUR noch im generischen globalen onUnhandledRejection-Handler (process-guards.js) -
// dort fehlen callId-Bezug und das aufrufer-eigene Log-Praefix, der Fehler ist im Stoerfall
// schwerer zu korrelieren. .catch faengt die Rejection HIER ab (bleibt async, KEIN await -
// das fire-and-forget-Timing bleibt erhalten) und loggt secret-frei: nur ein stabiles
// Praefix + optionale callId (Korrelation, keine PII) + e.message - NIE das ganze Error-
// Objekt/den Stack/Request/Token. callId ist optional, damit bestehende Aufrufer ohne
// Anpassung weiterlaufen; alle 5 realen Terminierungspfade reichen sie mit.
// Promise.resolve(bill()) statt bill().catch(...) direkt: bill() laeuft unveraendert
// SYNCHRON genau jetzt (identisches Timing zum vorherigen void bill()), aber das
// Ergebnis wird sicher in ein Promise gehoben - auch ein synchroner Nicht-Promise-
// Rueckgabewert (z.B. in Tests) hat dann ein .catch, statt terminateAndBillCall selbst
// zum Werfen zu bringen.
export async function terminateAndBillCall({ persistEnd, hangUp, bill, onHangUpError, callId }) {
  if (typeof bill !== "function")
    throw new TypeError("terminateAndBillCall: bill (Settlement) ist Pflicht - kein Function uebergeben");
  persistEnd();
  if (hangUp) {
    try {
      await hangUp();
    } catch (e) {
      onHangUpError?.(e);
    }
  }
  Promise.resolve(bill()).catch((e) => {
    console.error(`[terminateAndBillCall] Settlement fehlgeschlagen (call=${callId ?? "unbekannt"}):`, e?.message);
  });
}

// G5 (Review-Blocker Runde 2): der bill-Thunk war an allen 5 Terminierungspfaden
// woertlich (bzw. bis auf den Parameternamen) identisch dupliziert - EINE Quelle statt
// fuenffacher Wiederholung. Liest den Call bewusst FRISCH aus dem Store (nicht das evtl.
// veraltete call-Objekt des Aufrufers), da finishCall auf dem aktuellen persistierten
// Stand (Guards billedAt/reserveReleased) buchen muss. Rein (kein eigener I/O) -> DI-Muster
// wie hangUpAction: finishCall/store kommen injiziert herein, offline mit Spies testbar.
export function billThunk(finishCall, store, callId) {
  return () => finishCall(store.getCall(callId));
}

// P6 (Regel 1 / Befund 1): waehlt Hangup-Endpunkt+ID anhand der Call-FORM, NICHT der
// voiceEngine. Ein Call-Control-Call (callControlId gesetzt, C-Telnyx) wird ueber
// endCallViaCallControl(callControlId) beendet; ein TeXML-Call ueber endCall(
// providerCallSid) - byte-identisch zum Bestand. EINE Quelle (G5) fuer terminateCappedCall
// UND cancel_call, damit die ID-/Endpunkt-Entscheidung nicht an zwei Stellen driftet.
// Rein (DI: voiceControl kommt herein) -> offline mit Spy-voiceControl unit-testbar.
//
// Verzweigt an callControlId-PRAESENZ (nicht voiceEngine): ein TeXML-Hangup gegen einen
// Call-Control-Call schluege still fehl -> Cap orphant nach jedem Deploy, Kostenexplosion
// (Befund 1). Fehlen BEIDE IDs (z.B. Originate-Fehler vor sid) -> null: terminateAndBillCall
// ueberspringt den Hangup fail-safe (persistiert+bucht trotzdem). providerCallSid wird
// bewusst UEBERGEBEN (nicht aus call.twilioSid abgeleitet): der Inbound-Pfad armt mit
// req.body.CallSid, das nicht zwingend call.twilioSid entspricht -> Bestandsverhalten wahren.
export function hangUpAction(voiceControl, call, providerCallSid) {
  if (call.callControlId)
    return () => voiceControl(call.provider).endCallViaCallControl(call.callControlId);
  if (providerCallSid) return () => voiceControl(call.provider).endCall(providerCallSid);
  return null;
}

// TEIL B (Owner-Auftrag 15.08.2026): die PARALLELE Entscheidung fuer die EL-Call-FORM.
// hangUpAction() oben verzweigt ueber callControlId/providerCallSid (Telnyx-Form) und
// liefert fuer einen EL-Call (haelt STATTDESSEN call.elevenlabsConversationId) fail-safe
// null - der belegte Befund dieser Sitzung: ohne diese Funktion loest der EL-Weg an
// BEIDEN Terminierungsstellen (Max-Dauer-Cap, cancel_call) NIE einen Beende-Versuch aus -
// die Leitung laeuft weiter und kostet weiter.
//
// endActiveCall kommt INJIZIERT (DIP, wie voiceControl bei hangUpAction) - KEINE
// Import-Kante von telephony/** nach elevenlabs/**: dieses Modul kennt weder ElevenLabs
// noch das Netz, nur die Call-FORM. Der Aufrufer (server.js/app.js, Kompositionswurzel)
// bindet die echte Implementierung (elevenlabs/outbound.js#endActiveCall: Ergebnisabruf+
// Persistenz ZUERST, Loeschversuch DANACH). Fehlt endActiveCall (Kanal nicht verdrahtet
// oder Test ohne EL-Wiring) -> null, derselbe fail-safe wie bei hangUpAction ohne Handle.
export function elevenLabsHangUpAction(endActiveCall, call) {
  if (!call.elevenlabsConversationId || typeof endActiveCall !== "function") return null;
  return () => endActiveCall(call.id);
}

// OUTBOUND-E3b (Befund C-A aus dem E3a-Safety-Review): die Invariante "der Grund steht am
// Datensatz, BEVOR gebucht wird" war bisher nur in routes/api-calls.js Struktur; in
// routes/voice.js und elevenlabs/outbound.js war sie eine verschiebbare Anweisung - der
// Safety-Reviewer hat sie in voice.js verletzt, und die GESAMTE Suite blieb GRUEN. Diese
// Funktion ist die EINE Formulierung fuer alle Naehte: sie liefert den persistEnd-Thunk,
// in dem der Grund per Konstruktion ZUERST steht - es gibt an diesen Naehten danach keine
// Anweisung mehr, die man hinter das await schieben KOENNTE.
// store.recordFailureReason ist set-once und bei null ein No-op (store/state-ops.js:854).
// EIN Options-Argument (F1: max-params 3).
export function persistEndWithReason({ store, callId, reason, endCall }) {
  return () => {
    store.recordFailureReason(callId, reason);
    endCall();
  };
}
