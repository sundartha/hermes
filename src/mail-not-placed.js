// OUTBOUND-E3a (E-3): Ziel- und Sende-Entscheidung fuer die EINE Nutzer-Mail nach einem
// Anruf, der NIE ZUSTANDE KAM, WEIL WIR ODER DER ANBIETER ihn abgelehnt haben. Spiegel von
// mail-summary.js (planSummaryMail): reine Entscheidung hier, der Text wird beim Aufrufer
// gebaut (call-finish.js), der Versand laeuft ueber die BESTEHENDE Schleife
// sendMailToTargets - es entsteht KEIN zweiter Benachrichtigungsweg.
//
// WARUM NICHT planSummaryMail wiederverwendet (zwei Gruende, beide am Code):
//  (1) mail-summary.js:52 "if (!call.summary) return skip" - ein nie zustande gekommener
//      Anruf hat NIE eine Zusammenfassung, das Gate wuerde immer greifen.
//  (2) mail-summary.js:60 Newsletter-Einwilligung - diese Mail ist die Stoerungsmeldung zu
//      einem Auftrag, den der Nutzer selbst erteilt hat, keine Newsletter-Zustellung.
//
// KEINE Mail bei unreachable (der Angerufene war weg - Alltag, kein Vorfall), bei
// result-unknown, no-answer, busy, canceled, failed, max-duration-cap, budget-exhausted.
// Bei Millionen Nutzern waere eine Mail je Fehlanruf ein Dauer-Generator (Kosten,
// Missbrauchsflaeche, Zustellruf); not-placed ist per Definition selten UND unsere Schuld.
import { NOT_PLACED, failureReasonBase } from "./telephony/failure-reason.js";

// Entprell-Fenster: mehrere Fehlversuche hintereinander sind EIN Vorfall, nicht fuenf.
// Gemessener Anlassfall (tasks/befund-outbound-ausfall-2026-08-27.md): vier Versuche in
// sechs Minuten. Eine Stunde deckt das mit Reserve und laesst einen wirklich neuen Vorfall
// am naechsten Tag trotzdem durch. Benannte Konstanten statt Magic Numbers (G25); bewusst
// KEIN Env-Wert - es gibt heute genau einen Betreiber und keinen Anlass, daran zu drehen.
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const NOT_PLACED_MAIL_DEBOUNCE_MS = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

// Rein, ohne IO: hat derselbe Tenant im Fenster VOR diesem Anruf schon einen not-placed-
// Anruf beendet? Dann ist die Mail zu diesem Vorfall bereits raus.
// Quelle sind die PERSISTIERTEN call-Zeilen, kein In-Memory-Zaehler: der ueberlebt auf
// plan:free keinen Schlaf (pg.js:561-565 - platformSpendWarnedMonth ist strukturell ephemer).
export function notPlacedMailDebounced(calls, call, windowMs = NOT_PLACED_MAIL_DEBOUNCE_MS) {
  const endedMs = Date.parse(call.endedAt || "");
  if (Number.isNaN(endedMs)) return false; // ohne Anker nicht entprellen (lieber melden)
  return calls.some((other) => {
    if (other.id === call.id || other.tenantId !== call.tenantId) return false;
    if (failureReasonBase(other.failureReason) !== NOT_PLACED) return false;
    const otherMs = Date.parse(other.endedAt || "");
    return !Number.isNaN(otherMs) && otherMs < endedMs && endedMs - otherMs <= windowMs;
  });
}

// Gates in fester Reihenfolge, jede mit oder ohne Skip-Grund (Muster planSummaryMail).
//
// REIHENFOLGE bewusst: erst die zwei reinen Feldvergleiche, die entscheiden, ob dieser
// Anruf ueberhaupt ein KANDIDAT ist (Richtung, Basis-Token) - beide gleich billig wie der
// mailer-Check, aber semantisch vorrangig. "kein Mailer verdrahtet" ist nur dann eine
// meldenswerte Diagnose, wenn eine Mail sonst tatsaechlich faellig GEWESEN WAERE; vor den
// Kandidaten-Gates gepruefte, kaeme jeder gescheiterte Anruf JEDER Klasse (no-answer, busy,
// Cap, Budget, ...) mit no_mailer ins Audit, sobald kein Mailer verdrahtet ist - reines
// Rauschen statt Diagnose. ERST danach die teuren Schritte (Spiegel-Scan, Konto-Lookup),
// in aufsteigender Kostenreihenfolge - ein Skip aus einem frueheren Grund loest nie einen
// unnoetigen Store-/DB-Zugriff aus.
export async function planNotPlacedMail({ store, call, mailer, accounts }) {
  if (call.direction !== "outbound") return { send: false, targets: [], reason: null };
  if (failureReasonBase(call.failureReason) !== NOT_PLACED)
    return { send: false, targets: [], reason: null };
  if (!mailer) return { send: false, targets: [], reason: "no_mailer" };
  if (notPlacedMailDebounced(store.load().calls, call))
    return { send: false, targets: [], reason: null };
  const account = accounts ? await accounts.accountByTenant(call.tenantId) : null;
  if (!account?.email) return { send: false, targets: [], reason: "no_account_email" };
  // unsubToken null: die Konto-Adresse hat keinen Abmelde-Link (mail-summary.js:63) - eine
  // Stoerungsmeldung zum eigenen Auftrag ist ohnehin kein abbestellbarer Newsletter.
  return { send: true, targets: [{ email: account.email, unsubToken: null }], reason: null };
}
