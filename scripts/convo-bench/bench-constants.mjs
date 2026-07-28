// AL-P8-FIX1: gemeinsame Konstanten fuer Bench-Treiber (G5) - eigene Datei statt
// drivers.mjs, weil drivers.mjs selbst driver-texml.mjs/driver-shim.mjs importiert
// (Import von dort zurueck waere ein Zirkelbezug).

// Default-Anrufer fuer Szenarien ohne eigene callerNumber - Wegwerf-Wert, von beiden
// Treibern (TeXML und Shim) identisch verwendet.
export const BENCH_DEFAULT_CALLER = "+4915100000099";
