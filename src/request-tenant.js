// Re-Export-Naht: der Tenant-/Identitaets-Resolver wurde nach src/routes/_tenant.js
// konsolidiert (T4 Phase 1, siehe docs/strategy/t4-server-decomposition.md §3.2).
// Diese Datei bleibt als stabile Import-Naht bestehen, damit die A4-Importe
// (server.js, request-tenant-unit.test.js) byte-identisch weiterlaufen. KEINE Logik
// hier - eine einzige Quelle (test/tenant-resolver-parity.test.js sichert die
// Identitaet beider Pfade ab).
export * from "./routes/_tenant.js";
