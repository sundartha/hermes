// Test-Fixture-Helfer (PA-13): haengt die 13 Config-Namespaces als GETTER an einen flachen
// Test-Mock, EXAKT wie config.js es am globalen rawConfig tut (nicht-enumerable Gruppen,
// Blaetter delegieren auf denselben flachen Slot). So liest migrierter Code config.<ns>.<key>
// aus einem Hand-Mock, und ein Spread-Override eines flachen Schluessels schlaegt 1:1 auf den
// Namespace durch (kein PM-1-Stale). Verhaltensneutral fuer Pfade ohne Namespace-Zugriff.
// WICHTIG: NACH allen Spreads/Overrides anwenden (Namespaces sind nicht-enumerable -> ein
// spaeterer { ...mock } verliert sie); bei geteiltem Modul-CONFIG eine Spread-Kopie wrappen.
//
// EIGENE Datei statt in helpers.js (Pflicht, kein Stil-Entscheid): helpers.js importiert
// praktisch jedes Testfile ALS ALLERERSTES, VOR dessen eigenem process.env-Setup. Etliche
// Dateien nutzen bewusst das Muster "process.env setzen, DANACH config.js dynamisch
// importieren" (z.B. telnyx-call-control.test.js, claude-identity.test.js), um genau zu
// verhindern, dass config.js seinen env-Snapshot vor dem testeigenen Setup zieht (Lehre
// test-base-env-drift). Ein statischer config.js-Import in helpers.js wuerde config.js
// schon beim Import von helpers.js auswerten (ESM: Abhaengigkeiten werten vor dem
// importierenden Modul aus) - VOR dem env-Setup jeder aufrufenden Datei - und damit fuer
// die GESAMTE Suite denselben fail-open-Stale-Bug herbeifuehren, den das Muster verhindern
// soll (empirisch bestaetigt: 110 Suite-Faelle bei Erstversuch ueber helpers.js). Nur
// Dateien, die withConfigNamespaces tatsaechlich brauchen, importieren diese Datei -
// keine der PA-13-Zieldateien nutzt das env-vor-config-Muster (siehe PA-13-Report).
import { attachNamespaces, CONFIG_NAMESPACES } from "../src/config.js";

export function withConfigNamespaces(flatConfig) {
  attachNamespaces(flatConfig, CONFIG_NAMESPACES);
  return flatConfig;
}
