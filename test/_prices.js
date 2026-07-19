// EINE Preis-/Budget-Fixture (G5) fuer alle Kosten-/Budget-Tests. Vor P7a stand
// dieselbe Zeile byte-identisch in 8 Testdateien; mit der Modell-Preistabelle waere
// daraus 8x ein Mehrzeiler geworden.
//
// EIGENE Datei statt helpers.js (Pflicht, kein Stil-Entscheid): helpers.js importiert
// praktisch jede Testdatei ALS ALLERERSTES - siehe Modul-Kommentar in
// config-namespaces-helper.js. Diese Datei importiert NICHTS und liest KEIN process.env.
//
// Die Werte sind FIXTUREN, keine Kopie der Produktionstabelle aus src/config.js: sie
// duerfen bewusst abweichen, damit ein Preis-Update dort keine Kosten-Assertion hier
// rot faerbt. Verlangt wird nur die STRUKTUR (Modell-ID -> {inPerMTok,outPerMTok}).
export const TEST_MODEL_CHEAP = "claude-haiku-4-5";
export const TEST_MODEL_EXPENSIVE = "claude-sonnet-5";

export const PRICES = Object.freeze({
  modelPricesUsd: Object.freeze({
    [TEST_MODEL_CHEAP]: { inPerMTok: 1.0, outPerMTok: 5.0 },
    [TEST_MODEL_EXPENSIVE]: { inPerMTok: 3.0, outPerMTok: 15.0 },
  }),
  usdToEur: 0.93,
  platformSpendCapCents: 800,
});

// Verbrauchs-Tripel in der Bestands-Schreibweise (Default-Modell = das guenstige,
// wie vor P7a implizit). Haelt die Migration der Bestands-Call-Sites einzeilig und
// beweis-neutral: dieselben Token, derselbe Preis, dieselben erwarteten Cents.
export function tokensOf(inputTokens, outputTokens = 0, model = TEST_MODEL_CHEAP) {
  return { inputTokens, outputTokens, model };
}
