// Resilienter LLM-Client-Seam: EINE Stelle, die weiss, WIE robust
// mit Anthropic gesprochen wird - Timeout, selektiver Jitter-Retry, Connection-
// Hygiene, Circuit-Breaker. Alle Aufrufer (claude.js) haengen an dieser
// Abstraktion (DIP), nicht am rohen SDK. Beruehrt KEINE Safety-Gates und nicht die
// Disclosure - messages.create ist ein reiner, statusloser LLM-Call (idempotent,
// kein Toll-Fraud bei Retry).
//
// Connection-Hygiene: Das SDK 0.105 nutzt native fetch (undici unter Node) statt
// node-fetch/agentkeepalive. Ein expliziter undici-Dispatcher mit kurzem
// keepAliveTimeout (Umbrella 3.3) bleibt VORERST aussen vor: undici ist in Node 22
// NICHT als importierbares Modul freigegeben (nur intern fuer global fetch; empirisch
// belegt: import "undici"/"node:undici" werfen ERR_MODULE_NOT_FOUND/ERR_UNKNOWN_BUILTIN_MODULE,
// kein globalThis.getGlobalDispatcher). Ein eigener Dispatcher braeuchte daher undici
// als neue Dependency - ausserhalb des aktuellen Scopes (Owner-Freigabe noetig). Die Hygiene
// wirkt weiter ueber das Retry selbst: maxRetries:0 am SDK + manueller Retry holt beim
// Re-Request eine frische fetch-Connection (vergifteter Socket wird nicht im selben
// fetch wiederverwendet). Zusaetzlich faengt isTransient den neuen undici-Premature-
// close (UND_ERR_SOCKET) sowohl ueber APIConnectionError als auch als Defense-in-Depth.
import Anthropic from "@anthropic-ai/sdk";

// Transiente HTTP-Status: Verbindungs-/Lastklasse, vom Server gefahrlos wiederholbar.
// 408 Timeout, 409 Conflict, 429 RateLimit, >=500 Server. NICHT 400/401/403/404/422.
const RETRYABLE_STATUS = new Set([408, 409, 429]);
const SERVER_ERROR_MIN = 500;
// Rohe Transport-Fehlercodes (Verbindungsklasse, gefahrlos wiederholbar).
// UND_ERR_SOCKET = undici "other side closed": Unter dem SDK 0.105 (native fetch)
// erscheint der Premature close als APIConnectionError (von isTransient ueber branch 1
// gefangen); dessen verschachtelte cause traegt diesen undici-Code. Hier defensiv im
// Set, falls der instanceof-Pfad je ausfaellt (Defense-in-Depth, empirisch belegt).
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
// Voll-Jitter-Backoff verdoppelt die Basis pro Versuch (gegen Thundering Herd).
const BACKOFF_FACTOR = 2;

// Geworfen, wenn der Breaker offen ist ODER die Retry-Obergrenze erschoepft ist.
// Der Aufrufer faengt diesen Typ und rendert eine wuerdevolle Degradation.
// Traegt nur den Grund - niemals params, Key oder rohe Fehlerdetails (Secret-Schutz).
export class LlmUnavailableError extends Error {
  constructor(reason) {
    super(`LLM nicht verfuegbar: ${reason}`);
    this.name = "LlmUnavailableError";
    this.reason = reason; // "circuit-open" | "retries-exhausted"
  }
}

// Zwei-Klassen-Degradation fuer einen gescheiterten agentTurn-Aufruf: EINE Quelle
// fuer die Klassifikation, von /voice/turn (server.js) UND dem Telnyx-Brain-Shim
// gleichermassen genutzt (G5 - vorher an beiden Stellen byte-identisch dupliziert).
// LlmUnavailableError (Breaker offen ODER Retries erschoepft) -> wuerdevolles Ende
// (llmDegradedSpeech); jeder ANDERE Fehler (nicht-transient, z.B. 4xx/Auth) ->
// generisches technisches Ende (turnErrorSpeech).
export function degradedSpeechFor(err, locale) {
  return err instanceof LlmUnavailableError ? locale.llmDegradedSpeech : locale.turnErrorSpeech;
}

// Klassifiziert, ob ein Fehler transient (retrybar) ist. PURE Funktion, exportiert
// fuer den Unit-Test. Transient: Premature-close-FetchError, APIConnectionError,
// ECONNRESET & Co., HTTP 408/409/429/>=500. NICHT transient: 4xx (ausser 408/409/429),
// invalid_request, Auth -> sofort werfen (kein Over-Retry maskiert einen Config-Fehler).
export function isTransient(err) {
  if (!err) return false;
  // 1) APIConnectionError/-Timeout (status undefined) -> transient.
  if (err instanceof Anthropic.APIConnectionError) return true;
  // 2) APIError mit status -> nur die retrybare Klasse.
  if (typeof err.status === "number")
    return RETRYABLE_STATUS.has(err.status) || err.status >= SERVER_ERROR_MIN;
  // 3) Rohe Transportfehler (Premature close & Co.) ueber code/message.
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  if (err.message === PREMATURE_CLOSE_MESSAGE) return true;
  // 4) Verschachtelter Transportfehler (z.B. APIConnectionError.cause = ECONNRESET).
  if (err.cause && err.cause !== err) return isTransient(err.cause);
  return false; // 4xx/invalid_request/Auth/unbekannt -> sofort werfen
}

// Exponentieller Voll-Jitter-Backoff. random injiziert -> deterministisch testbar
// (kein Math.random im Hot-Path-Test). 0/1 als Exponent erlaubt.
function backoffDelay({ baseMs, attempt, jitter, random }) {
  const exp = baseMs * BACKOFF_FACTOR ** attempt;
  return jitter ? Math.floor(random() * exp) : exp;
}

// Circuit-Breaker (interne Factory, kein Export - Verhalten ueber complete()/withRetry()
// getestet). FSM: closed -> bei Fehlerschwelle im rollenden Fenster -> open (Cooldown)
// -> half-open (eine Probe) -> success => closed / fail => open. Reine Zeit ueber das
// injizierte now() (kein echtes Date.now im Test). Kappt Retry-Stuerme bei Brownout.
function makeBreaker({ threshold, windowMs, cooldownMs }, now) {
  let failures = []; // Zeitstempel transienter Fehler im Fenster
  let state = "closed"; // closed | open | half-open
  let openedAt = 0;
  return {
    state: () => state,
    // Laesst nach Cooldown EINE Probe durch (half-open). Nebeneffekt im Namen sichtbar?
    // Nein - isOpen klingt nach reinem Query; der Cooldown-Uebergang ist aber Teil der
    // FSM-Auswertung. Daher hier bewusst als Abfrage-mit-Zustandsuebergang dokumentiert.
    isOpen() {
      if (state !== "open") return false;
      if (now() - openedAt >= cooldownMs) {
        state = "half-open";
        return false;
      }
      return true;
    },
    recordSuccess() {
      failures = [];
      state = "closed";
    },
    recordFailure() {
      const t = now();
      failures = failures.filter((ts) => t - ts < windowMs);
      failures.push(t);
      if (state === "half-open" || failures.length >= threshold) {
        state = "open";
        openedAt = t;
      }
    },
  };
}

// Resilienter Wrapper um EINEN async-Call. Exportiert fuer den Unit-Test (DIP: fn +
// sleep + random injizierbar, kein echtes Netz/keine echte Zeit). Begrenzt (max),
// exponentiell + Jitter (baseMs), nur bei retryable(err). Meldet jeden transienten
// Fehlversuch + jeden Erfolg an den Breaker.
export async function withRetry(fn, { max, baseMs, jitter, retryable, sleep, random }, breaker) {
  let attempt = 0;
  for (;;) {
    try {
      const out = await fn();
      breaker?.recordSuccess();
      return out;
    } catch (err) {
      const transient = retryable(err);
      if (transient) breaker?.recordFailure();
      if (!transient || attempt >= max) throw err; // selektiv + Obergrenze
      const delay = backoffDelay({ baseMs, attempt, jitter, random });
      attempt += 1;
      await sleep(delay);
    }
  }
}

// Metrik-Hook als No-op (echter PII-freier Emitter folgt spaeter). Hier nur die Form
// fixiert (outcome/attempts/latencyMs/breakerState), damit ein spaeterer Emitter nur
// das Backend einsetzt, nicht die Aufrufstellen aendert.
const noopMetrics = { llmCall() {} };
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// I13 (call-quality Impl-1): additive Metrik-Felder, NUR wenn tatsaechlich vorhanden -
// kein Rauschen im Breaker-open-/Fehlerpfad (dort gibt es weder eine Response noch
// immer einen callId). callId korreliert den Anthropic-Request mit dem Call (PII-frei,
// wie metrics.logTurn schon callId traegt); die Cache-Zaehler kommen 1:1 aus resp.usage
// (dieselbe Quelle wie claude.js inputTokensOf) und dienen NUR der Bench-/Latenz-
// Auswertung (L1) - NIE dem Budget-Gate (das bleibt unveraendert an trackUsage haengen).
function metricsExtra(callId, usage) {
  const extra = {};
  if (callId !== undefined) extra.callId = callId;
  if (usage?.cache_creation_input_tokens !== undefined)
    extra.cache_creation_input_tokens = usage.cache_creation_input_tokens;
  if (usage?.cache_read_input_tokens !== undefined)
    extra.cache_read_input_tokens = usage.cache_read_input_tokens;
  return extra;
}

// Factory (P15: Konstruktion/Verdrahtung getrennt vom Fachcode). <=4 benannte Felder
// in EINEM Optionsobjekt (F1). messagesCreate ist ein optionaler Test-Seam (DIP):
// gesetzt -> ersetzt sdk.messages.create; sonst = der echte Prod-Pfad (kein toter Code).
export function createLlmClient({
  apiKey,
  config,
  sleep = defaultSleep,
  metrics = noopMetrics,
  messagesCreate,
} = {}) {
  const sdk = new Anthropic({
    apiKey,
    timeout: config.llm.llmRequestTimeoutMs, // expliziter Per-Request-Timeout (Pflicht; SDK-Default 10 min waere webhook-toedlich)
    maxRetries: 0, // manueller Retry ERSETZT den SDK-Retry (sonst doppelte Backoffs)
  });
  const create = messagesCreate || ((params) => sdk.messages.create(params));
  const breaker = makeBreaker(
    {
      threshold: config.llm.llmBreakerThreshold,
      windowMs: config.llm.llmBreakerWindowMs,
      cooldownMs: config.llm.llmBreakerCooldownMs,
    },
    Date.now,
  );
  // I13: callId ist ein additiver Bench-/Metrik-Begleiter, KEIN Anthropic-Request-Feld -
  // er wird hier abgestreift (Rest-Destrukturierung), bevor params an create()/das SDK
  // geht (kein Leak eines unbekannten Feldes in den Provider-Request-Body).
  async function complete({ callId, ...params } = {}) {
    if (breaker.isOpen()) {
      metrics.llmCall({
        outcome: "breaker-open",
        attempts: 0,
        breakerState: "open",
        ...metricsExtra(callId),
      });
      throw new LlmUnavailableError("circuit-open");
    }
    const startedAt = Date.now();
    let attempts = 0;
    try {
      const resp = await withRetry(
        () => {
          attempts += 1;
          return create(params);
        },
        {
          max: config.llm.llmMaxRetries,
          baseMs: config.llm.llmBackoffMs,
          jitter: true,
          retryable: isTransient,
          sleep,
          random: Math.random,
        },
        breaker,
      );
      metrics.llmCall({
        outcome: "success",
        attempts,
        latencyMs: Date.now() - startedAt,
        breakerState: breaker.state(),
        ...metricsExtra(callId, resp.usage),
      });
      return resp;
    } catch (err) {
      const exhausted = isTransient(err); // transient + durch withRetry geworfen -> Retries erschoepft
      metrics.llmCall({
        outcome: exhausted ? "retries-exhausted" : "non-transient",
        attempts,
        latencyMs: Date.now() - startedAt,
        breakerState: breaker.state(),
        ...metricsExtra(callId),
      });
      if (exhausted) throw new LlmUnavailableError("retries-exhausted");
      throw err; // nicht-transient (4xx/Auth) unveraendert nach oben
    }
  }
  return { complete };
}
