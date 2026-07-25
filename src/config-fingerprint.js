// ---- Deploy-Wahrheit: Konfigurations-Fingerabdruck (GAP-36) ----------------------
// EINE Stelle, die die sicherheits-/geld-relevanten Konfigurationsachsen des LAUFENDEN
// Prozesses zu EINEM Vergleichswert verdichtet. Zweck: der Live-Dienst ist
// Dashboard-managed (render.yaml ist Referenz, nicht Wahrheit) - ohne diesen Wert ist
// nach Deploy oder Rollback nicht belegbar, WELCHE Konfiguration wirklich laeuft.
//
// ABSOLUTE REGEL 4 (SECRETS): Einweg-Hash ueber GENAU fuenf nicht-geheime Achsen. NIE
// ein Rohwert - /healthz ist unauthentifiziert; ausgeschriebene allowedCountryCodes und
// maxCallsPerHour waeren die Landkarte fuer einen Toll-Fraud-Burst. Kein Secret, keine
// Tenant-Groesse, keine Rufnummer fliesst ein.
//
// DIP: config kommt als Argument (kein Import des Singletons) -> unit-testbar ohne Env.
import { createHash } from "node:crypto";

// Trennzeichen zwischen den Achsen. Kommt in keinem der fuenf Werte vor - sonst koennten
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
  ];
  return createHash("sha256").update(axes.join(AXIS_SEPARATOR)).digest("hex");
}
