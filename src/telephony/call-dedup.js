// Praedikat "dieser Tenant telefoniert GERADE mit dieser Nummer" (S3/E3, Anforderung N-11).
// REIN: kein Store, kein config, kein IO, kein Date.now - alle Werte werden hereingereicht.
// Vorbild und Nachbar ist src/callee-is-owner.js (dessen Modulkopf begruendet diese Bauart).
//
// STRIKTER VERGLEICH, mit Absicht. Kein Praefix-Match, keine letzten n Ziffern, kein Trim,
// KEINE Normalisierung im Praedikat: die ist vorgelagert und geteilt (normalize_target-Gate,
// telephony/outbound-gates.js schreibt ctx.to). Ein Praedikat, das selbst normalisiert, wird
// irgendwann grosszuegig normalisieren - und grosszuegig heisst hier: ein absichtlicher
// Zweitanruf wird stillschweigend geschluckt.
//
// DER SCHLUESSEL IST SERVERSEITIG: Tenant + normalisiertes Ziel + "laeuft noch" + Fenster.
// KEIN client-gelieferter Idempotenz-Schluessel - ein Modell erfindet ihn beim Wiederholen neu
// und schuetzt genau in dem Fall nicht, fuer den er gebaut waere.
//
// WARUM EIN FENSTER: ein haengengebliebener active-Datensatz (Poll-Abbruch) wuerde dieses EINE
// Ziel sonst bis zum Dauer-Cap sperren. 180 s ist zugleich >= PLACE_CALL_HOP_TIMEOUT_MS
// (mcp-tools.js): ein Host-Retry NACH unserem Fristablauf landet noch im Fenster. Die zwei
// Konstanten sind bewusst NICHT per Import gekoppelt (Fenster = Server-Zustand, Frist =
// Transport-Bound); die Invariante haelt test/openai-s3-hop-frist.test.js fest.
export const DEDUP_WINDOW_MS = 180000;

// Fehlendes/unparsebares startedAt zaehlt NICHT ins Fenster (NaN-Vergleich ist false). Das ist
// die Richtung "wie vor dieser Phase" (es wird gewaehlt) und kann kein Gate aushebeln - die
// gesamte Gate-Kette ist zu diesem Zeitpunkt bereits gefahren.
function imFenster(call, nowMs) {
  return Date.parse(call.startedAt) >= nowMs - DEDUP_WINDOW_MS;
}

/**
 * Der juengste laufende Outbound-Anruf dieses Tenants an genau dieses Ziel, oder null.
 * @param {Array<object>} activeCalls  store.activeCallsFor(tenantId) - richtungsoffen
 * @param {{to: string, nowMs: number}} input  to = ctx.to (bereits normalisiert)
 */
export function findDuplicateOutboundCall(activeCalls, { to, nowMs }) {
  if (!Array.isArray(activeCalls) || typeof to !== "string" || to === "") return null;
  return activeCalls
    .filter((call) => call.direction === "outbound" && call.to === to && imFenster(call, nowMs))
    // Deterministische Wahl auch bei mehreren Treffern (Altbestand): der juengste gewinnt,
    // bei Gleichstand der spaetere Eintrag - nie "irgendeiner".
    .reduce((neuster, call) => (!neuster || call.startedAt >= neuster.startedAt ? call : neuster), null);
}
