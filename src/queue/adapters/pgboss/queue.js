// pg-boss-Queue-Adapter (P6b2): VORBEREITET, nicht aktiv. Echte pg-boss-Integration
// ist nach P8 deferred (LOCKED OWNER-ENTSCHEIDUNG: pglite testet LISTEN/NOTIFY nicht;
// kein neuer npm-Dependency in P6b2). Bis dahin wirft die Konstruktion fail-closed,
// damit QUEUE_BACKEND=pgboss nicht still ein No-op-Subsystem startet (Geld-/Job-Pfad).
export function makePgBossQueue() {
  throw new Error("pg-boss-Queue ist noch nicht implementiert (deferred nach P8) - QUEUE_BACKEND=memory verwenden");
}
