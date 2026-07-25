// LCT P6: leitet die per-Tenant-Kostendecke aus dem gebuchten Plan ab. NICHT in plans.js
// (dort: reines Daten-Modul + 1:1-Spiegel apps/web/src/lib/plans.js, den
// test/plans-catalog.test.js byte-genau pinnt - eine config-lesende Ableitung dort
// leakte die Innenkalkulation ins Marketing-Bundle ODER risse den Spiegel-Test).
// LIEST includedMinutes aus plans.js (SSoT bleibt dort), der Basissatz kommt als cfg herein.
// Reines Rechenmodul: KEIN IO, KEIN store-Import (Leaf-Modul, azyklisch).
import { findPlan } from "../plans.js";

// Kopffreiheit je Plan als GANZZAHLIGER BRUCH (Zaehler/Nenner), NICHT als Dezimalzahl:
// 1,6667 ist gerundet und 30*6*1.6667 = 300,006 - eine Geldgrenze, die von einer Rundung
// im Aufrufer abhinge (G26 auf dem Geld-Pfad). Entscheidung 2 (2026-07-20): Starter 5/3,
// Business 5/4 -> exakt 300 / 900 ct. Produkt-Entscheidung, KEINE Env (bewusst nicht
// konfigurierbar - test-gepinnt, nicht per Operator verstellbar).
const PLAN_CAP_HEADROOM = Object.freeze({
  starter: Object.freeze({ numerator: 5, denominator: 3 }),
  business: Object.freeze({ numerator: 5, denominator: 4 }),
});

// planCapCents(slug, cfg) = includedMinutes * voiceCapRateCentsPerMin * num / den.
// ZUERST multiplizieren, GENAU EINMAL am Ende dividieren (alle Operanden ganzzahlig) -
// so bleibt das Ergebnis Ganzzahl (30*6*5=900 -> /3=300; 120*6*5=3600 -> /4=900).
// WIRFT bei einem UNBEKANNTEN Slug (fail-closed: ein neuer Plan ohne Kopffreiheit-Eintrag
// darf NICHT still auf einen Default zurueckfallen). Der Aufrufer stellt sicher, dass er
// nur mit nicht-leerem Slug ruft; leerer/fehlender Slug ist KEIN Fall dieser Funktion (die
// No-op-Entscheidung fuer diesen Fall liegt an der Schreibkante, nicht hier).
export function planCapCents(planSlug, cfg) {
  const plan = findPlan(planSlug);
  const headroom = PLAN_CAP_HEADROOM[planSlug];
  if (!plan || !headroom) {
    throw new Error(`planCapCents: unbekannter Plan-Slug '${planSlug}' (kein Katalog-/Kopffreiheit-Eintrag)`);
  }
  return (plan.includedMinutes * cfg.voiceCapRateCentsPerMin * headroom.numerator) / headroom.denominator;
}

// GAP-03/O2: inkludierte Minuten der laufenden Periode. Nach einer Rueckerstattung
// (periodCreditRevoked) ist das Guthaben dieser Periode aufgebraucht (0) - kein Hard-
// Suspend, der Tenant bleibt aktiv und inbound erreichbar. EINE Quelle fuer Gate
// (outbound-gates.js planMinutesExhausted) UND Anzeige (meter.js quotaView) - Anzeige-
// Fenster == Gate-Fenster ist Repo-Invariante. plan kann null sein (kein bekannter Plan) ->
// undefined (die jeweiligen Aufrufer behandeln das bereits fail-closed).
export function includedMinutesFor({ plan, subscription }) {
  if (subscription?.periodCreditRevoked) return 0;
  return plan?.includedMinutes;
}
