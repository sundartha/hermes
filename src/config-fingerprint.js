// ---- Deploy-Wahrheit: Konfigurations-Fingerabdruck (GAP-36) ----------------------
// EINE Stelle, die die sicherheits-/geld-relevanten Konfigurationsachsen des LAUFENDEN
// Prozesses zu EINEM Vergleichswert verdichtet. Zweck: der Live-Dienst ist
// Dashboard-managed (render.yaml ist Referenz, nicht Wahrheit) - ohne diesen Wert ist
// nach Deploy oder Rollback nicht belegbar, WELCHE Konfiguration wirklich laeuft.
//
// ABSOLUTE REGEL 4 (SECRETS): Einweg-Hash ueber GENAU sieben nicht-geheime Achsen. NIE
// ein Rohwert - ausgeschriebene allowedCountryCodes und maxCallsPerHour waeren die
// Landkarte fuer einen Toll-Fraud-Burst. Kein Secret, keine Tenant-Groesse, keine
// Rufnummer fliesst ein.
//
// OpenAI-P10b: DIESER WERT IST NICHT OEFFENTLICH. Live gemessen und per Preimage aus
// 9216 Kandidaten eindeutig zurueckgerechnet (PLAN-SECURITY.md, Abschnitt "OpenAI-P10b",
// Punkt 1) - fuer die niedrig-entropischen Achsen hier (Land-Codes, ein Stundenlimit,
// zwei Kosten-Decken, zwei Booleans, eine Waehrung) ist ein Einweg-Hash KEIN Schutz,
// sondern gibt die Rohwerte effektiv im Klartext preis. Deshalb steht der RUECKGABEWERT
// dieser Funktion NUR noch hinter einer
// Admin-Sitzung (GET /api/admin/deploy-info, src/routes/api-deploy-info.js) und im
// Boot-Log (src/boot.js) - NICHT mehr auf /healthz (src/app.js).
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
