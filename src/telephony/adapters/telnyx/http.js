// Telnyx-HTTP-Grundbausteine: Auth-Header, Basis-URL, JSON-Parsing. EINE Stelle (G5) statt
// eines zweiten HTTP-Clients - extrahiert aus numbers.js (OUTBOUND-E4/E-6), das diese zwei
// Funktionen zuvor unveraendert selbst trug. voice.js bleibt bewusst AUSSEN VOR (Deviation
// D-3, PLAN-OUTBOUND-RESILIENZ.md Abschnitt 4.3): es sendet form-encodiert (TeXML) und hat
// eine eigene, nicht identische headers()-Formulierung - ein Zusammenschnitt waere eine
// Aenderung am heissen Anrufpfad ohne Auftrag.
import { config } from "../../../config.js";

export function telnyxAuthHeaders(extra = {}) {
  if (!config.telephony.telnyxApiKey)
    throw new Error("Telnyx: TELNYX_API_KEY fehlt");
  return {
    Authorization: `Bearer ${config.telephony.telnyxApiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export const telnyxUrl = (path) => config.telephony.telnyxApiBase + path;

// Telnyx-Ressourcen-IDs sind 19-stellig (gemessen: connection_id 3026479542865757220,
// tasks/befund-outbound-ausfall-2026-08-27.md). JSON.parse rundet jede Ganzzahl ab 2^53
// STILL - aus 3026479542865757220 wird 3026479542865757000, und ein String-Vergleich
// schlaegt fehl, obwohl beide Seiten dieselbe Ressource meinen. Deshalb werden lange
// Ganzzahl-Literale VOR dem Parsen gequotet; alles andere bleibt unberuehrt. Betroffene
// Feldnamen sind die, die der Drift-Waechter tatsaechlich vergleicht (id/connection_id/
// phone_number_id) - eine generische "jede lange Zahl quoten"-Regel wuerde auch legitime
// Zahlenfelder (Betraege, Zaehler) in Strings verwandeln.
const LANGE_ID = /("(?:id|connection_id|phone_number_id)"\s*:\s*)(\d{16,})/g;

export async function telnyxJson(res) {
  const roh = await res.text();
  return roh ? JSON.parse(roh.replace(LANGE_ID, '$1"$2"')) : {};
}
