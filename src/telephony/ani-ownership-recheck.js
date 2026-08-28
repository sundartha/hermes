// OUTBOUND-E4 Review-Blocker (BLOCKER 1 / G9/C2): der ANI-Riegel (outbound-gates.js#
// ani_ownership) verlangt vor jeder Ablehnung eine LIVE-Nachmessung ("Schutzschicht 2",
// PLAN-SECURITY.md) - GENAU der GET aus Pruefung 3 (telnyxRead.findPhoneNumber), aber
// mit einem eigenen kurzen Timeout und OHNE den vollen Neun-Pruefungen-Lauf. Die
// Kontoeigentums-Frage selbst beantwortet kontoBesitzt() (outbound-config-drift.js, EINE
// Quelle, G5) - dieses Modul liefert ihr nur den Messwert, mit Timeout.
//
// Rueckgabe der Fabrik: true (Verlust BESTAETIGT) | false (Konto besitzt sie) | null
// (unbekannt: leere e164, Anbieterfehler oder Timeout). Das Gate behandelt jeden
// Nicht-true-Wert als "durchlassen" (fail-open bei Unwissen, PM-2) - dieses Modul wirft
// bei einem Timeout ABSICHTLICH (das Gate faengt das selbst ab, s. dessen eigener
// try/catch), damit Fail-open eine Eigenschaft DES GATES bleibt, nicht eine Disziplin
// dieses Aufrufers.
import { kontoBesitzt } from "./outbound-config-drift.js";

// Kurzer, technischer Timeout fuer EINEN einzelnen GET - kein Business-Schwellenwert
// (der lebt in config.safety.outboundAniGateMaxAgeMs), sondern die Obergrenze, wie lange
// place_call auf DIESE eine Nachmessung wartet, bevor sie als "unbekannt" gilt.
export const ANI_RECHECK_TIMEOUT_MS = 4000;

function mitTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error("ani-ownership-recheck: Timeout"), { name: "TimeoutError" }));
    }, timeoutMs);
    promise.then(
      (wert) => {
        clearTimeout(timer);
        resolve(wert);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function makeAniOwnershipRecheck({ telnyxRead, timeoutMs = ANI_RECHECK_TIMEOUT_MS }) {
  return async function aniOwnershipRecheck(e164) {
    if (!e164) return null;
    const antwort = await mitTimeout(telnyxRead.findPhoneNumber(e164), timeoutMs);
    const status = kontoBesitzt({ ok: true, wert: antwort }, e164);
    if (status === "unbekannt") return null;
    return status === "verloren";
  };
}
