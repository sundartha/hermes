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
// (grund=/deckung=/schwelle=/seit=/anfragen=/kanaele=). Hier wird nichts angereichert.
export function makeDurableAudit({ audit, auditStoreRef }) {
  const meldeSchreibfehler = (err) =>
    console.error("[audit] durabler Eintrag fehlgeschlagen:", err.message);
  return (action, req, detail = "") => {
    audit(action, req, detail);
    const sink = auditStoreRef.current;
    if (!sink) return;
    try {
      // tenantId/actorSub bleiben null: ein Plattform-Ereignis ist keinem Tenant und
      // keiner Identitaet zuzurechnen (Muster audit(action, null, ...) -> ip=system).
      Promise.resolve(sink.record({ action, detail: detail || null })).catch(meldeSchreibfehler);
    } catch (err) {
      meldeSchreibfehler(err); // synchroner Wurf des Sinks
    }
  };
}
