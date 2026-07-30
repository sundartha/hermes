// Geteilte Max-Dauer-Rechnung (G5): das harte Max-Dauer-Limit eines Calls in Millisekunden.
// EINE Quelle fuer beide Telephony-Aufrufer: die Budget-Engine-Timer in
// telephony/call-lifecycle.js (armMaxDurationTimer + Reserve-Release-Backstop) UND den
// Realtime-Cap-Timer in bridge.js - vorher zweifach die rohe Formel
// "(maxDurationS || default) * 1000", in bridge.js mit rohem Magic-1000 (G25).
//
// MS_PER_SECOND kommt aus utils/timer.js (G5, Review-Blocker Runde 2): dort bereits
// als geteilte Konstante etabliert und von telnyx-call-control-ingest.js sowie
// telnyx-conversation-watchdog.js importiert - keine eigene Deklaration hier noetig,
// utils/timer.js ist blattfoermig (importfrei) und daher zyklusfrei importierbar.
import { MS_PER_SECOND } from "./utils/timer.js";
// KS-P3 (b): die absolute Obergrenze der Notbremse. Blatt-Modul (Datenkonstanten, kein
// IO, keine config) - zyklusfrei importierbar, dieselbe Richtung wie boot-guard.js.
import { MAX_CALL_DURATION_CAP_S } from "./store/defaults.js";

// Bewusst NICHT unter src/telephony/ (Review-Blocker Runde 1): eine Datei innerhalb der
// Telephony-Schicht waere fuer die Store-Schicht (src/store/state-ops.js) technisch nicht
// importierbar (Schichtregel: Store darf Telephony nicht importieren). Dieser Top-Level-Ort
// ist schichtneutral - analog zu src/util.js - und koennte von jeder Schicht importiert werden.
//
// Trotzdem bleibt state-ops.js#callLimitMs eine ZWEITE, unabhaengige Kopie derselben Formel
// (OQ-1, Owner-bestaetigt): die Migration von state-ops.js auf diesen Helfer ist bewusst NICHT
// Teil dieser Runde. Das ist also weiterhin eine ECHTE Duplizierung (G5), keine aufgeloeste -
// nur die Positionierung ist jetzt korrekt fuer eine kuenftige Zusammenfuehrung vorbereitet.
//
// Config-frei (Muster state-ops.js callLimitMs): der Fallback wird vom Aufrufer
// hereingereicht - dieses Modul importiert config NICHT, bleibt rein und offline
// unit-testbar.
//
// call-eigenes maxDurationS schlaegt den Fallback (|| : 0/null/undefined -> Fallback).
// KS-P3: die Frist steht seit dieser Phase AM CALL (beim Anlegen aus dem Restguthaben
// abgeleitet, s. emergencyBrakeSeconds unten); der Fallback greift nur noch fuer Zeilen
// OHNE eigene Frist und ist bei allen Aufrufern MAX_CALL_DURATION_CAP_S - der frueher
// hier durchgereichte Env-Default MAX_CALL_DURATION_S ist mit E2/E3 entfallen.
export function callMaxDurationMs(call, defaultMaxDurationS) {
  return (call.maxDurationS || defaultMaxDurationS) * MS_PER_SECOND;
}

// Sekunden->Minuten-Bruecke der Notbremse (G25: benannte Konstante statt nackter 60).
// Modul-lokal wie in boot-guard.js/outbound-gates.js - Zeit-Einheit, kein
// Betriebsparameter (G35 n.z.).
const SECONDS_PER_MINUTE = 60;

// KS-P3 (b) / E8: der Puffer, um den die Notbremse ueber den bezahlbaren Minuten liegt.
// Er ist die STRUKTURELLE Zusage, dass im Normalbetrieb IMMER der Live-Zaehler zuerst
// bindet und die Notbremse die zweite Linie bleibt - ohne ihn traefe bei exakt
// aufgehendem Guthaben die Uhr zuerst, und der Kunde saehe einen wortlosen Abbruch
// statt des Abschiedssatzes.
export const BRAKE_BUFFER_MINUTES = 1;

// Volle Minuten, die das Restguthaben zum Leg-Satz noch traegt. null = nicht ableitbar
// (der Aufrufer entscheidet, was das heisst) - bewusst kein stilles 0 und kein NaN.
function affordableMinutes(remainingCents, tariffCentsPerMin) {
  if (!Number.isFinite(remainingCents)) return null;
  if (!Number.isFinite(tariffCentsPerMin) || tariffCentsPerMin <= 0) return null;
  return Math.max(0, Math.floor(remainingCents / tariffCentsPerMin));
}

// KS-P3 (b): die Frist, nach der ein Leg OHNE weitere Turns hart beendet wird. Keine
// Konfigurationsgroesse mehr, sondern aus dem Restguthaben abgeleitet (E2/E3/E8): wer
// viel Guthaben hat, telefoniert lange; wer wenig hat, kurz. Der Schaden eines
// haengenden Anrufs ist damit PROPORTIONAL zum Guthaben statt auf eine willkuerliche
// Zahl gedeckelt.
//
// Drei Riegel, alle bewusst:
//   Restminuten nie negativ  -> Math.max(0, ...) in affordableMinutes: ein
//     ueberreservierter Bucket liefert legitim ein negatives remainingCents (kein
//     D7-Fall, s. tenantBudgetSnapshot); daraus darf keine Frist in der Vergangenheit
//     werden. Untergrenze bleibt der Puffer allein = 60 s, NIE 0 - eine 0-Frist
//     terminalisierte den Call schon beim Armieren, und "kein Geld" ist die Aufgabe der
//     Geld-Achse, nicht der Uhr.
//   nicht aufloesbares Guthaben (remainingCents null = D7-Riegel, oder Satz <= 0)
//     -> die absolute Obergrenze, NIE "unbegrenzt". Derselbe Zustand sperrt am Dial
//     ohnehin ueber reserveUnreadableDenial und beim Inbound ueber budgetExceeded - die
//     Notbremse ist dort nie die letzte Linie.
//   absolute Obergrenze -> hartkodiert (MAX_CALL_DURATION_CAP_S), kein Env-Knopf.
export function emergencyBrakeSeconds({ remainingCents, tariffCentsPerMin }) {
  const affordable = affordableMinutes(remainingCents, tariffCentsPerMin);
  if (affordable === null) return MAX_CALL_DURATION_CAP_S;
  return Math.min(
    (affordable + BRAKE_BUFFER_MINUTES) * SECONDS_PER_MINUTE,
    MAX_CALL_DURATION_CAP_S,
  );
}
