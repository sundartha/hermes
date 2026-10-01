// Praedikat "dieser beendete Anruf QUALIFIZIERT als Inbox-Eintrag" (PLAN-ANRUF-INBOX,
// INBOX-P1, Entwurfsentscheidung E-2).
//
// REIN: kein Store, kein IO, keine Zeit, kein Log. Der einzige Import ist die GETEILTE
// Substanz-Primitive aus claude.js - die Regel darueber lebt ausschliesslich hier
// (G5/S2: keine zweite Kopie in call-finish.js oder im Store). Vorbild und Nachbar ist
// src/callee-is-owner.js.
//
// EIGENE SCHWELLEN, KEIN ENV-KNOPF (Muster MAX_OPEN_POLLS_PER_CALL, consult/delivery.js).
// Die geteilte Primitive haengt an CALLER_SUBSTANCE_MIN_LEN (Default 2) - einer Zahl, die
// fuer den Auflege-/Deadlock-Schutz kalibriert ist. Sie allein liesse "aeh"/"mh"/"ok" als
// Gespraech durchgehen (Pre-Mortem R-2). Die Inbox-Regel darueber ist strenger.
import { isSubstantialCallerText } from "./claude.js";

// Mindestens zwei substanzielle Anrufer-Zeilen ODER in Summe mindestens 12 Anrufer-Zeichen.
// ODER, nicht UND: ein einziger inhaltsreicher Satz ist ein Gespraech, zwei kurze echte
// Turns ebenfalls - ein einzelnes "ok" faellt durch beide.
const INBOX_MIN_CALLER_TURNS = 2;
const INBOX_MIN_CALLER_CHARS = 12;

// Die substanziellen Anrufer-Zeilen dieses Anrufs. Fail-closed: fehlendes/kaputtes
// Transkript -> leere Liste, nie ein Wurf.
function substantialCallerLines(call) {
  const transcript = Array.isArray(call?.transcript) ? call.transcript : [];
  return transcript.filter((entry) => entry?.role === "caller" && isSubstantialCallerText(entry.text));
}

// Bedingung 3 aus E-2. AUSDRUECKLICH NICHT callerHasSpoken: das zaehlt fuer Inbound JEDE
// nicht-leere caller-Zeile (auch ein Echo-Fragment ".") und beantwortet die andere Frage
// ("darf der Agent auflegen"), nicht diese ("gab es Gespraechsinhalt").
function hasInboxSubstance(call) {
  const lines = substantialCallerLines(call);
  if (lines.length >= INBOX_MIN_CALLER_TURNS) return true;
  const chars = lines.reduce((sum, entry) => sum + entry.text.length, 0);
  return chars >= INBOX_MIN_CALLER_CHARS;
}

// Die vollstaendige Bedingung dieser Etappe, an EINER Stelle. Rueckgabe strikt Boolean.
// settings ist der Tenant-Kontext-Ausschnitt (store.tenantContext(...).settings); fehlt er,
// ist die Antwort false (fail-closed).
export function qualifiesAsInboxEntry(call, settings) {
  if (!call || call.direction !== "inbound") return false;
  if (call.status !== "completed") return false;
  if (settings?.allowSummaries !== true) return false;
  return hasInboxSubstance(call);
}
