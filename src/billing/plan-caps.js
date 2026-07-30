// LCT P6: leitet die per-Tenant-Kostendecke aus dem gebuchten Plan ab. NICHT in plans.js
// (dort: reines Daten-Modul + 1:1-Spiegel apps/web/src/lib/plans.js, den
// test/plans-catalog.test.js byte-genau pinnt - eine config-lesende Ableitung dort
// leakte die Innenkalkulation ins Marketing-Bundle ODER risse den Spiegel-Test).
// LIEST includedMinutes aus plans.js (SSoT bleibt dort), der Basissatz kommt als cfg herein.
// Reines Rechenmodul: KEIN IO, KEIN store-Import (Leaf-Modul, azyklisch).
import { findPlan } from "../plans.js";

// Kopffreiheit je Plan als GANZZAHLIGER BRUCH (Zaehler/Nenner), NICHT als Dezimalzahl:
// 1,6667 ist gerundet und 30*30*1.6667 = 1500,03 - eine Geldgrenze, die von einer Rundung
// im Aufrufer abhinge (G26 auf dem Geld-Pfad). Entscheidung 2 (2026-07-20): Starter 5/3,
// Business 5/4. Produkt-Entscheidung, KEINE Env (bewusst nicht konfigurierbar -
// test-gepinnt, nicht per Operator verstellbar).
//
// KS-P5a/E5a: die Kopffreiheit traegt seither ZWEI Lasten, und beide muessen bei JEDEM
// Satz T > 0 aufgehen:
//   (1) die verkauften Minuten selbst:                    M*T       <= M*T*num/den
//   (2) plus die Worst-Case-Reserve des LETZTEN Anrufs:   M*T + 5*T <= M*T*num/den
//       (5 = ceil(MAX_CALL_DURATION_CAP_S / 60))
// (2) fordert M >= 7,5 (Starter, 5/3) bzw. M >= 20 (Business, 5/4); der Katalog liegt mit
// 30 bzw. 120 verkauften Minuten darueber. Nachgerechnet wird das - satzunabhaengig und
// fuer JEDEN Katalog-Slug - in test/ks-p5a-plan-cap-carries-sold-minutes.test.js.
const PLAN_CAP_HEADROOM = Object.freeze({
  starter: Object.freeze({ numerator: 5, denominator: 3 }),
  business: Object.freeze({ numerator: 5, denominator: 4 }),
});

// planCapCents(slug, cfg) = includedMinutes * voiceTariffDefaultCents * num / den.
// KS-P5a/E5a: das ist DERSELBE Satz, mit dem der Verbrauch gebucht wird (tariffCentsPerMin,
// Worst-Case-Zweig) - einen zweiten Deckel-Basissatz gibt es nicht mehr. Bewusst der
// Worst-Case- und nicht der Inlandssatz: die Decke muss vorab feststehen, und ein
// Inlands-Leg bucht guenstiger, passt also erst recht darunter.
// ZUERST multiplizieren, GENAU EINMAL am Ende dividieren (alle Operanden ganzzahlig) -
// das Ergebnis ist fuer JEDEN ganzzahligen Satz T ganzzahlig (Starter 30*T*5/3 = 50T,
// Business 120*T*5/4 = 150T; bei T=30 also 1500 / 4500 ct).
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
  return (plan.includedMinutes * cfg.voiceTariffDefaultCents * headroom.numerator) / headroom.denominator;
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
