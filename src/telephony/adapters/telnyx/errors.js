// Telnyx-Fehler-Envelope: EIN gemeinsamer Parser + assertOk fuer alle Telnyx-v2-Adapter
// (voice/numbers). Telnyx liefert bei Fehlern {errors:[{code,title,detail}]}. Eine Stelle
// (G5) statt zwei gegensaetzlicher Implementierungen im selben Provider-Package.
//
// Sicherheit (Regel 4/5): STRIKT allowlisted - NUR code/title, plus detail NUR wenn der
// Aufrufer es per includeDetail anfordert. Raw-Body und unbekannte Felder werden NIE
// durchgereicht (kein API-Key-/Roh-Body-Dump). detail kann Auth-/Nummern-Fragmente tragen
// -> Default AUS (voice schliesst es so aus); ein Aufrufer, der es einschaltet (numbers fuer
// die 402-Diagnose), traegt das dokumentierte Restrisiko (PLAN-SECURITY.md). detail wird auf
// ERROR_DETAIL_MAX_LEN gekuerzt (Log-Volumen-Bremse, kein Raw-Dump).

// Max-Laenge je Telnyx-detail-Feld in der Fehlermeldung: begrenzt das Log-Volumen eines
// unerwartet grossen detail-Strings. Interner Log-Hygiene-Bound, kein Operator-Tuning-Knopf
// -> modul-lokale Konstante, nicht config.js.
const ERROR_DETAIL_MAX_LEN = 200;

// Liest den Telnyx-Fehler-Envelope NON-DESTRUKTIV (nur im !ok-Zweig; der Erfolgspfad der
// Adapter liest weiter res.json()) und extrahiert STRIKT allowlisted code/title[/detail].
// Fehlt/kaputt der Body -> "" (assertTelnyxOk faellt auf status-only zurueck, der throw
// passiert immer).
async function telnyxErrorEnvelope(res, { includeDetail = false } = {}) {
  let raw;
  try {
    raw = await res.text();
  } catch {
    return "";
  }
  if (!raw) return "";
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return ""; // kein JSON -> kein Rohtext-Dump (Leak-Schutz)
  }
  const errors = Array.isArray(body && body.errors) ? body.errors : [];
  return errors
    .map((e) => {
      if (!e) return "";
      const head = [e.code != null ? String(e.code) : "", e.title].filter(Boolean).join(" ");
      if (!includeDetail) return head;
      const detail = e.detail ? String(e.detail).slice(0, ERROR_DETAIL_MAX_LEN) : "";
      return [head, detail].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
}

// Wirft bei HTTP-Fehler MIT Status (P8) und - falls vorhanden - dem allowlisted Telnyx-
// code/title[/detail], damit der echte Ablehnungsgrund im Log steht statt nacktem "HTTP 4xx".
// attachStatus haengt err.providerStatus an (Aufrufer-Kategorisierung in server.js). Der
// API-Key leakt NIE (Regel 4/5). Bei res.ok ein No-Op.
export async function assertTelnyxOk(res, op, { includeDetail = false, attachStatus = false } = {}) {
  if (res.ok) return;
  const detail = await telnyxErrorEnvelope(res, { includeDetail });
  const err = new Error(
    `Telnyx ${op} fehlgeschlagen: HTTP ${res.status}${detail ? ` (${detail})` : ""}`,
  );
  if (attachStatus) err.providerStatus = res.status;
  throw err;
}
