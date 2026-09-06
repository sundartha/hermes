// Consult-Faehigkeits-Gate: die EINE Stelle, an der Master-Schalter, Kontext-Kanal
// und Per-Tenant-Freigabe zur Schnittmenge werden. Fail-closed: eine fehlende
// Bedingung -> false -> kein Consult emittiert, keine Route, kein Tool registriert
// (Bestandsverhalten byte-identisch).
//
// EIGENE DATEI statt in delivery.js (Vorbild: die Intersection-Rolle von
// src/research/registry.js): das Gate hat MEHRERE Konsumenten quer durch die Schichten
// (Routen, MCP, Anrufstart, Rueckfrage-Webhook). In delivery.js gelegt haette diese Datei zwei Gruende zur Aenderung
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

// DIE Frage "darf DIESER Anruf eine Rueckfrage stellen" - eine Stelle, zwei Aufrufer: der
// Anrufstart (elevenlabs/outbound.js, per DI hereingereicht) fuer die dynamische Variable
// consult_available und der Rueckfrage-Webhook (routes/webhooks-elevenlabs.js), bevor er
// einen get_consult annimmt. Genau die Divergenz dieser beiden Stellen war der Defekt vom
// 06.09.2026: der Anrufstart sagte dem Prompt "unavailable", der Webhook nahm den Aufruf
// trotzdem an und hielt die Leitung stumm (W1 in PLAN-ANRUFDEFEKTE.md). Ein Prompt ist kein
// Tor, nur der Server ist eins - deshalb darf diese Bedingung nirgends ein zweites Mal
// ausgeschrieben werden.
//
// STRIKT !== true, nicht === false: ein Anruf-Datensatz aus der Zeit vor dem Feld traegt
// undefined und gilt als NICHT-Owner - dieselbe Semantik wie an jeder anderen Lesestelle
// (claude.js, elevenlabs/outbound.js, elevenlabs/convai.js). Kein optionaler Zugriff auf
// call: beide Aufrufer haben den Datensatz bereits gebunden, und ein fehlender waere hier
// ein Programmierfehler, der laut werden soll statt still zu erlauben.
export function consultAllowedForCall(call, profile) {
  return consultAllowedFor(profile) && call.calleeIsOwner !== true;
}
