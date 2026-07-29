// Consult-Faehigkeits-Gate: die EINE Stelle, an der Master-Schalter, Kontext-Kanal
// und Per-Tenant-Freigabe zur Schnittmenge werden. Fail-closed: eine fehlende
// Bedingung -> false -> kein Consult emittiert, keine Route, kein Tool registriert
// (Bestandsverhalten byte-identisch).
//
// EIGENE DATEI statt in delivery.js (Vorbild: die Intersection-Rolle von
// src/research/registry.js): das Gate hat ZWEI Konsumenten (routes/api-calls.js und
// routes/mcp.js). In delivery.js gelegt haette diese Datei zwei Gruende zur Aenderung
// (P2/SRP) und mcp.js muesste die Zustellform importieren, um eine Ja/Nein-Frage zu
// stellen. "gate" statt "registry", weil es keine Adapter-Tabelle gibt (S4: keine
// Indirektion ohne Mehrwert).
//
// assistantContextEnabled ist PFLICHT-Faktor, nicht Kosmetik: die Antwort landet in
// call.context.key_facts, und assistantContextSection (claude.js) rendert bei
// ausgeschaltetem Kanal "" - der Consult waere sonst eine Rueckfrage ohne Wirkung.
// Exakt dieselbe Kopplung wie briefingActive() in src/precall-briefing.js.
import { config } from "../config.js";

export function consultAllowedFor(profile) {
  return (
    config.tenancy.consultEnabled === true &&
    config.tenancy.assistantContextEnabled === true &&
    profile?.allowConsult === true
  );
}
