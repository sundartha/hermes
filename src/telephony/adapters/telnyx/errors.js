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
//
// Der allowlistete code haengt zusaetzlich STRUKTURIERT am Error (err.providerCode), damit
// Aufrufer ihn loggen/kategorisieren koennen, ohne die Meldung zu regexen (der Text ist kein
// Vertrag). NUR code - NIE title, NIE detail, NIE der Roh-Body.

// Max-Laenge je Telnyx-detail-Feld in der Fehlermeldung: begrenzt das Log-Volumen eines
// unerwartet grossen detail-Strings. Interner Log-Hygiene-Bound, kein Operator-Tuning-Knopf
// -> modul-lokale Konstante, nicht config.js.
const ERROR_DETAIL_MAX_LEN = 200;

// Liest den Telnyx-Fehler-Envelope NON-DESTRUKTIV (nur im !ok-Zweig; der Erfolgspfad der
// Adapter liest weiter res.json()) und extrahiert STRIKT allowlisted code/title[/detail].
// EINE Auswertung, ZWEI Projektionen (G5): `text` fuer die Fehlermeldung, `code` als
// strukturiertes Feld fuer Aufrufer, die den Telnyx-Code maschinell brauchen. `code` ist der
// des ERSTEN Eintrags (Telnyx fuehrt den ausloesenden Fehler zuerst) und NIE eine Kopie von
// detail/title. Fehlt/kaputt der Body -> { text:"", code:null } (assertTelnyxOk faellt auf
// status-only zurueck, der throw passiert immer).
const EMPTY_ENVELOPE = Object.freeze({ text: "", code: null });

async function telnyxErrorEnvelope(res, { includeDetail = false } = {}) {
  let raw;
  try {
    raw = await res.text();
  } catch {
    return EMPTY_ENVELOPE;
  }
  if (!raw) return EMPTY_ENVELOPE;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return EMPTY_ENVELOPE; // kein JSON -> kein Rohtext-Dump (Leak-Schutz)
  }
  const errors = Array.isArray(body && body.errors) ? body.errors : [];
  const text = errors
    .map((e) => {
      if (!e) return "";
      const head = [e.code != null ? String(e.code) : "", e.title].filter(Boolean).join(" ");
      if (!includeDetail) return head;
      const detail = e.detail ? String(e.detail).slice(0, ERROR_DETAIL_MAX_LEN) : "";
      return [head, detail].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
  const firstWithCode = errors.find((e) => e && e.code != null);
  return { text, code: firstWithCode ? String(firstWithCode.code) : null };
}

// Wirft bei HTTP-Fehler MIT Status (P8) und - falls vorhanden - dem allowlisted Telnyx-
// code/title[/detail], damit der echte Ablehnungsgrund im Log steht statt nacktem "HTTP 4xx".
// attachStatus haengt err.providerStatus an (Aufrufer-Kategorisierung in server.js). Der
// API-Key leakt NIE (Regel 4/5). Bei res.ok ein No-Op.
//
// providerCode haengt OHNE Opt-in an (anders als providerStatus, das additiv fuer genau eine
// Aufrufer-Kategorisierung eingefuehrt wurde): derselbe Wert steht bereits in JEDER Meldung
// (Allowlist code+title) - ihn strukturiert danebenzulegen fuegt keine Information hinzu, die
// der Aufrufer nicht ohnehin im Text haette. Genau deshalb bleibt detail weiter per Opt-in
// (includeDetail): detail KANN Auth-/Nummern-Fragmente tragen, der code nicht.
export async function assertTelnyxOk(res, op, { includeDetail = false, attachStatus = false } = {}) {
  if (res.ok) return;
  const envelope = await telnyxErrorEnvelope(res, { includeDetail });
  const err = new Error(
    `Telnyx ${op} fehlgeschlagen: HTTP ${res.status}${envelope.text ? ` (${envelope.text})` : ""}`,
  );
  if (attachStatus) err.providerStatus = res.status;
  if (envelope.code) err.providerCode = envelope.code;
  throw err;
}
