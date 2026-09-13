// AL-P8-FIX1: gemeinsame Konstanten fuer Bench-Treiber (G5) - eigene Datei statt
// drivers.mjs, weil drivers.mjs selbst driver-texml.mjs/driver-shim.mjs importiert
// (Import von dort zurueck waere ein Zirkelbezug).

// Default-Anrufer fuer Szenarien ohne eigene callerNumber - Wegwerf-Wert, von beiden
// Treibern (TeXML und Shim) identisch verwendet.
export const BENCH_DEFAULT_CALLER = "+4915100000099";

// IE6-S1: aus telnyx-fake.mjs hierher verschoben (die Datei ist mit dem Assistant-Pfad
// entfernt) - der TeXML-Treiber ist seither der einzige Nutzer. Dummy-Signatur-Header:
// SKIP_TWILIO_SIGNATURE_CHECK ueberspringt die Krypto, die PRAESENZ waehlt den Provider.
export const TELNYX_DUMMY_HEADERS = Object.freeze({
  "telnyx-signature-ed25519": "bench-dummy",
  "telnyx-timestamp": "0",
});
