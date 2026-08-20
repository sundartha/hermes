// Praedikat "das Ziel dieses Outbound-Anrufs IST die eigene Nummer des anrufenden
// Tenants" (PLAN-OWNER-CALL, OC-P1). An dieser Entscheidung haengt ab OC-P2, ob ein
// GESETZLICHER Pflichtsatz gesprochen wird (Art. 50 AI Act, Absolute Regel 2). Deshalb
// gilt hier die schaerfste Form von fail-closed: jede fehlende Zutat, jeder Formatzweifel,
// jeder Nicht-String ergibt false - und false heisst IMMER "Offenlegung bleibt".
//
// REIN: kein Store, kein config, kein IO, kein Import. Alle Werte werden hereingereicht.
// Vorbild und Nachbar ist src/diagnostic-retention.js (dessen Modulkopf begruendet genau
// diese Bauart) - offline und ohne Spawn testbar.
//
// STRIKTER VERGLEICH, mit Absicht. Kein Praefix-Match, kein Vergleich der letzten n
// Ziffern, keine Gross-/Kleinschreibungs-Toleranz, kein Trim, KEINE Normalisierung im
// Praedikat. Die Normalisierung ist vorgelagert und geteilt (normalize_target-Gate,
// telephony/outbound-gates.js) - ein Praedikat, das selbst normalisiert, wird irgendwann
// grosszuegig normalisieren, und grosszuegig heisst hier: ein Fremder bekommt einen Anruf
// ohne Offenlegung. Der Riegel dagegen ist die Fall-Tabelle in test/callee-is-owner.test.js.
//
// ZWEI EXPORTE, EIN VERGLEICH. diagnostic-retention.js braucht NUR den Nummern-Vergleich
// und darf ausdruecklich NICHT am Offenlegungs-Schalter haengen (sonst faellt mit einem
// Flag-Flip still ein Bestandsfeature aus). routes/api-calls.js braucht NUR die
// vollstaendige Bedingung und darf sie nicht selbst zusammensetzen (sonst gibt es zwei
// Wahrheiten darueber, was "Owner-Anruf" heisst). Eine Datei, ein Vergleich, zwei benannte
// Zugaenge (G5).
//
// KEIN WURF, KEIN LOG, KEIN try/catch. Es gibt in diesem Modul keinen Aufruf, der werfen
// koennte (typeof, ===, Array.isArray, Array.prototype.includes). Ein spaeter eingebautes
// try/catch waere die Stelle, an der aus einem Fehler versehentlich ein true wird.

function istNichtLeererString(wert) {
  return typeof wert === "string" && wert !== "";
}

// Der nackte Nummern-Vergleich. Beide Seiten muessen nicht-leere Strings sein UND exakt
// gleich - sonst false. Rueckgabe strikt Boolean.
export function calleeIsOwner({ to, ownNumber }) {
  return istNichtLeererString(to) && istNichtLeererString(ownNumber) && to === ownNumber;
}

// Die Tenant-Allowlist ist Teil der BEDINGUNG, nicht ein Detail des Aufrufers: sie
// beantwortet "darf DIESER Account die Ausnahme ueberhaupt ausloesen". Fehlend, kein Array
// oder LEER heisst NIEMAND - nie JEDER (haeufigste Art, eine Allowlist in eine fail-open-
// Attrappe zu verwandeln). Das Trimmen/Splitten der Env-Liste passiert EINMAL in
// config.js, hier wird nur strikt verglichen.
function tenantDarfAusloesen(tenantId, allowedTenantIds) {
  if (!istNichtLeererString(tenantId)) return false;
  if (!Array.isArray(allowedTenantIds)) return false;
  return allowedTenantIds.includes(tenantId);
}

// Die vollstaendige Bedingung dieses Plans, an EINER Stelle:
//   Schalter an  UND  Tenant in der Allowlist  UND  Ziel == eigene Nummer.
// enabled wird strikt gegen true geprueft: ein "true" aus einer Env, das irgendwo als
// String durchgereicht wurde, ist NICHT wahr (boolEnv in config.js liefert einen echten
// Boolean; diese Zeile ist die zweite Linie).
export function ownerSelfCallGranted({ to, ownNumber, tenantId, enabled, allowedTenantIds }) {
  if (enabled !== true) return false;
  if (!tenantDarfAusloesen(tenantId, allowedTenantIds)) return false;
  return calleeIsOwner({ to, ownNumber });
}
