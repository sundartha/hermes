// KV2-1: die Naht zwischen der KONSOLEN-Audit-Zeile (util.js#audit - ein console.log und
// sonst nichts) und dem DURABLEN Schreiber (audit-store.js#makeAuditStore). Der Befund
// dahinter ist gemessen (AUFTRAG B3): 11 Tage 0 % Deckung, emitFinding feuerte korrekt,
// und `select ... from audit_log where action='cost_truing_befund'` lieferte 0 Zeilen.
//
// Warum eine ZELLE und nicht die Instanz: der Schreiber braucht den Portal-pg-Runner und
// entsteht erst spaet, im pg-gated guardedBoot-Block (wiring/web-login.js). makeCostTruing
// wird davor SYNCHRON verdrahtet. Dieselbe Lage wie bei accountsRef (server.js) - dieselbe
// Loesung, kein zweites Muster. Die Zelle IST die Naht; der Aufrufer bekommt eine fertige
// Funktion und initialisiert nichts nach (P15, kein Lazy-Init im Verbraucher).
//
// FAIL-SOFT, absolut: ein Schreibfehler darf niemals einen Sweep oder den Boot abbrechen.
// Die Konsolenzeile ist zu diesem Zeitpunkt bereits geschrieben - sie geht nie verloren.
// STORE_BACKEND=json hat keinen Runner: current bleibt null, der durable Zweig ist ein
// No-op (bewusste Festlegung, Plan 4.10).
//
// PII/Secrets: detail kommt ausschliesslich von Aufrufern mit PII-freiem Zeilen-Vertrag
// (grund=/deckung=/schwelle=/seit=/anfragen=/kanaele=/call=/consult=/halt_ms=/
// zugestellt_nach_ms=/quittiert_nach_ms=). Hier wird nichts angereichert.
export function makeDurableAudit({ audit, auditStoreRef, tenantId = null }) {
  const meldeSchreibfehler = (err) =>
    console.error("[audit] durabler Eintrag fehlgeschlagen:", err.message);
  return (action, req, detail = "") => {
    audit(action, req, detail);
    const sink = auditStoreRef.current;
    if (!sink) return;
    try {
      // actorSub bleibt null: keines dieser Ereignisse entsteht aus einer Identitaet.
      // tenantId ist BINDUNG DER INSTANZ, nicht Angabe des Aufrufers (P3): der
      // Plattform-Auditor (server.js#durableAudit) bindet nichts und schreibt wie bisher
      // null - ein Plattform-Ereignis ist keinem Mandanten zuzurechnen. Ein gebundener
      // Auditor (durableAuditFor) bekommt den Mandanten in der Kompositionswurzel. Zwei
      // Gruende fuer die Fabrik statt eines vierten Arguments: die Aufrufstelle im Fachcode
      // bleibt dreistellig (F1, eslint max-params 3), und eine Aufrufstelle kann keinen
      // FALSCHEN Mandanten mitgeben - sie kennt ihn gar nicht.
      Promise.resolve(sink.record({ action, tenantId, detail: detail || null }))
        .catch(meldeSchreibfehler);
    } catch (err) {
      meldeSchreibfehler(err); // synchroner Wurf des Sinks
    }
  };
}
