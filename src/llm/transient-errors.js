// Die ANBIETER-UNABHAENGIGE Haelfte von LlmErrorClassification.isTransient (llm/ports.js):
// HTTP-Statusklasse und rohe Transportfehler. Sie stand bis B5 vollstaendig im
// Anthropic-Adapter und waere im DeepSeek-Adapter byte-identisch gewesen (G5/S2) - ein
// zweiter Satz Status-Codes waere genau die Duplizierung, die auseinanderlaeuft.
//
// Was hier NICHT hingehoert: der anbieter-EIGENE Anteil (Anthropic: der SDK-Fehlertyp
// APIConnectionError). Den reicht jeder Adapter als Praedikat herein.
//
// Fail-closed-Richtung unveraendert (llm/ports.js): unbekannt -> false, also kein Retry.

// Transiente HTTP-Status: Verbindungs-/Lastklasse, vom Server gefahrlos wiederholbar.
// 408 Timeout, 409 Conflict, 429 RateLimit, >=500 Server. NICHT 400/401/403/404/422.
const RETRYABLE_STATUS = new Set([408, 409, 429]);
const SERVER_ERROR_MIN = 500;
// eslint-disable-next-line hermes/keine-kommentare
// Hinweis, der durch die Abschaltung frei sein soll
// Rohe Transport-Fehlercodes (Verbindungsklasse, gefahrlos wiederholbar).
// UND_ERR_SOCKET = undici "other side closed": Unter dem Anthropic-SDK 0.105 (native
// fetch) erscheint der Premature close als APIConnectionError (ueber das Anbieter-
// Praedikat gefangen); dessen verschachtelte cause traegt diesen undici-Code. Hier
// defensiv im Set, falls der instanceof-Pfad je ausfaellt (Defense-in-Depth, empirisch
// belegt). Der DeepSeek-Adapter spricht mit nacktem fetch und hat KEIN Anbieter-
// Praedikat - fuer ihn ist dieses Set der einzige Fang der Transportklasse.
// ERR_STREAM_PREMATURE_CLOSE bleibt als node-fetch-Erbe (Bedrock/aeltere Pfade).
const TRANSIENT_CODES = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
]);
const PREMATURE_CLOSE_MESSAGE = "Premature close";

// Baut das isTransient eines Adapters. isProviderConnectionError ist sein EIGENER Anteil
// (Default: keiner). Die Rekursion ueber cause laeuft bewusst durch DIESELBE Closure -
// ein verschachtelter Fehler wird also weiterhin auch gegen das Anbieter-Praedikat
// gehalten (sonst waere die Auslagerung keine reine Verschiebung).
export function makeTransientClassifier(isProviderConnectionError = () => false) {
  return function isTransient(err) {
    if (!err) return false;
    // 1) Anbieter-eigener Verbindungsfehler (status undefined) -> transient.
    if (isProviderConnectionError(err)) return true;
    // 2) Fehler mit status -> nur die retrybare Klasse.
    if (typeof err.status === "number")
      return RETRYABLE_STATUS.has(err.status) || err.status >= SERVER_ERROR_MIN;
    // 3) Rohe Transportfehler (Premature close & Co.) ueber code/message.
    if (err.code && TRANSIENT_CODES.has(err.code)) return true;
    if (err.message === PREMATURE_CLOSE_MESSAGE) return true;
    // 4) Verschachtelter Transportfehler (z.B. APIConnectionError.cause = ECONNRESET).
    if (err.cause && err.cause !== err) return isTransient(err.cause);
    return false; // 4xx/invalid_request/Auth/unbekannt -> sofort werfen
  };
}
