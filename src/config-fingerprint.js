// ---- Deploy-Wahrheit: Konfigurations-Fingerabdruck (GAP-36) ----------------------
// EINE Stelle, die die sicherheits-/geld-relevanten Konfigurationsachsen des LAUFENDEN
// Prozesses zu EINEM Vergleichswert verdichtet. Zweck: der Live-Dienst ist
// Dashboard-managed (render.yaml ist Referenz, nicht Wahrheit) - ohne diesen Wert ist
// nach Deploy oder Rollback nicht belegbar, WELCHE Konfiguration wirklich laeuft.
//
// ABSOLUTE REGEL 4 (SECRETS): Einweg-Hash ueber GENAU sieben nicht-geheime Achsen. NIE
// ein Rohwert - /healthz ist unauthentifiziert; ausgeschriebene allowedCountryCodes und
// maxCallsPerHour waeren die Landkarte fuer einen Toll-Fraud-Burst. Kein Secret, keine
// Tenant-Groesse, keine Rufnummer fliesst ein.
//
// P7: die beiden Kosten-Decken (Plattform + Tenant-Default) kamen dazu. Ohne sie war eine
// reine Zahlen-Aenderung an den Decken am laufenden Dienst NICHT belegbar - genau die
// Blindheit, gegen die dieser Fingerabdruck gebaut wurde. Beide sind Betreiber-Zahlen,
// kein Secret, und fliessen ohnehin nur in den Hash.
//
// DIP: config kommt als Argument (kein Import des Singletons) -> unit-testbar ohne Env.
import { createHash } from "node:crypto";

// Trennzeichen zwischen den Achsen. Kommt in keinem der sieben Werte vor - sonst koennten
// zwei verschiedene Konfigurationen dieselbe Zeichenkette und damit denselben Hash
// ergeben (G25: benannte Konstante statt nacktem Literal).
const AXIS_SEPARATOR = "|";

export function configFingerprint(config) {
  const axes = [
    config.safety.allowedCountryCodes.join(","),
    config.safety.maxCallsPerHour,
    config.billing.budgetMonthEnabled,
    config.tenancy.multiTenant,
    config.billing.paymentCurrency,
    config.billing.platformSpendCapCents,
    config.billing.defaultTenantBudgetCents,
  ];
  return createHash("sha256").update(axes.join(AXIS_SEPARATOR)).digest("hex");
}
