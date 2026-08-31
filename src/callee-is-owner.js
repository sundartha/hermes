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

// Besitz-Verifikation (Owner-Entscheidung 2026-08-21, OC) ERSETZT die frueherer
// Tenant-Allowlist als zweite Bedingung: sie beantwortet nicht mehr "steht dieser Account
// auf einer von Hand gepflegten Liste", sondern "hat DIESER Tenant den Besitz DIESER
// Nummer nachgewiesen" (E-Mail-Bestaetigung + Anruf von der Nummer selbst, s.
// src/own-number-verify.js und state-ops.js verifyPrivateNumberByInboundCall). verified
// wird strikt gegen true geprueft - undefined/false/"true"/1 sind allesamt NICHT
// verifiziert, aus demselben Grund wie beim enabled-Flag direkt darunter.
function nummerIstBesitzVerifiziert(verified) {
  return verified === true;
}

// Die vollstaendige Bedingung dieses Plans, an EINER Stelle:
//   Schalter an  UND  Besitz verifiziert  UND  Ziel == eigene Nummer.
// enabled wird strikt gegen true geprueft: ein "true" aus einer Env, das irgendwo als
// String durchgereicht wurde, ist NICHT wahr (boolEnv in config.js liefert einen echten
// Boolean; diese Zeile ist die zweite Linie).
export function ownerSelfCallGranted({ to, ownNumber, enabled, verified }) {
  if (enabled !== true) return false;
  if (!nummerIstBesitzVerifiziert(verified)) return false;
  return calleeIsOwner({ to, ownNumber });
}
