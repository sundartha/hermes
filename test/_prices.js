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
// rot faerbt. Verlangt wird nur die STRUKTUR (Modell-ID -> die vier Raten je
// Token-Sorte, seit B4a).
//
// Die zwei Cache-Raten sind seit B4a PFLICHT, nicht Kosmetik: 0 / 1e6 * undefined ist
// NaN, und ein NaN-Betrag laesst turnIncrementsBookable den Turn verwerfen - eine
// Fixture ohne sie waere nicht bloss rot, sie waere fail-OPEN.
export const TEST_MODEL_CHEAP = "claude-haiku-4-5";
export const TEST_MODEL_EXPENSIVE = "claude-sonnet-5";

export const PRICES = Object.freeze({
  modelPricesUsd: Object.freeze({
    [TEST_MODEL_CHEAP]: { inPerMTok: 1.0, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outPerMTok: 5.0 },
    [TEST_MODEL_EXPENSIVE]: { inPerMTok: 3.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outPerMTok: 15.0 },
  }),
  usdToEur: 0.93,
  platformSpendCapCents: 800,
});

// Verbrauchsform mit allen vier Token-Sorten (llm/ports.js LlmTokenUsage). EINE Quelle
// (G5) - tokensOf unten ist der Sonderfall "kein Cache" und delegiert hierher.
export function tokensWithCache({
  uncached = 0,
  cacheWrite = 0,
  cacheRead = 0,
  output = 0,
  model = TEST_MODEL_CHEAP,
}) {
  return {
    inputUncachedTokens: uncached,
    inputCacheWriteTokens: cacheWrite,
    inputCacheReadTokens: cacheRead,
    outputTokens: output,
    model,
  };
}

// Bestands-Schreibweise (Default-Modell = das guenstige, wie vor P7a implizit): dieselben
// Token, derselbe Preis, dieselben erwarteten Cents wie vor B4a - die Cache-Sorten sind 0,
// die ungecachte Sorte traegt die volle Zahl.
export function tokensOf(inputTokens, outputTokens = 0, model = TEST_MODEL_CHEAP) {
  return tokensWithCache({ uncached: inputTokens, output: outputTokens, model });
}
