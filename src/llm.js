// Resilienter LLM-Client-Seam: EINE Stelle, die weiss, WIE robust mit einem
// Sprachmodell-Anbieter gesprochen wird - Timeout/Wanduhr, selektiver Jitter-Retry,
// Circuit-Breaker, Metrik. Alle Aufrufer (claude.js, precall-briefing.js) haengen an
// dieser Abstraktion (DIP), nicht am rohen SDK. Beruehrt KEINE Safety-Gates und nicht
// die Disclosure - eine Modellrunde ist ein reiner, statusloser Call (idempotent, kein
// Toll-Fraud bei Retry).
//
// B3a: das gesamte ANBIETER-Wissen (SDK-Konstruktion, Antwort-Bloecke, Stream-
// Ereignisse, Fehler-Marken) liegt in den Adaptern unter src/llm/adapters/. Der Seam
// kennt nur noch den Port-Vertrag aus src/llm/ports.js.
//
// B5: WELCHER Adapter faehrt, entscheidet die Registry (src/llm/registry.js) aus
// LLM_PROVIDER - nicht dieser Seam und nicht seine Aufrufer. Die Wahl kommt dort aus dem
// config-SINGLETON, nicht aus dem hier uebergebenen config-Objekt: der Anbieter ist eine
// prozessweite Tatsache, die Resilienz-ZAHLEN sind es nicht (precall-briefing.js baut
// bewusst eine zweite Instanz mit eigenem Timeout/Retry - aber nie mit einem zweiten
// Anbieter). Deshalb nimmt createLlmClient auch keinen apiKey mehr entgegen: welcher
// Schluessel zum Anbieter gehoert, weiss die Registry.
import { activeLlmErrors, createLlmProvider } from "./llm/registry.js";

// Voll-Jitter-Backoff verdoppelt die Basis pro Versuch (gegen Thundering Herd).
const BACKOFF_FACTOR = 2;

// AL-P9: die beiden Abbruch-Gruende als EINE Quelle statt Roh-Strings an den throw-
// Stellen und beim Leser. Der Unterschied ist KOSTENRELEVANT: bei CIRCUIT_OPEN ging nie
// ein Request raus (isOpen wirft VOR create()), bei RETRIES_EXHAUSTED war mindestens ein
// Versuch auf der Leitung und kann beim Anbieter Token erzeugt haben - genau darauf
// bucht src/precall-briefing.js seine pessimistische Schaetzung.
export const LLM_UNAVAILABLE_REASON = Object.freeze({
  CIRCUIT_OPEN: "circuit-open",
  RETRIES_EXHAUSTED: "retries-exhausted",
  // AL-P7: unsere EIGENE Wanduhr-Sicherung hat den Stream beendet. Kein Anbieter-Fehler
  // und kein Retry-Fall (Text ist zum Teil schon gesprochen) - aber der Versuch WAR auf
  // der Leitung, es sind Token entstanden.
  STREAM_ABORTED: "stream-aborted",
});

// Geworfen, wenn der Breaker offen ist ODER die Retry-Obergrenze erschoepft ist.
// Der Aufrufer faengt diesen Typ und rendert eine wuerdevolle Degradation.
// Traegt nur den Grund - niemals params, Key oder rohe Fehlerdetails (Secret-Schutz).
export class LlmUnavailableError extends Error {
  constructor(reason) {
    super(`LLM nicht verfuegbar: ${reason}`);
    this.name = "LlmUnavailableError";
    this.reason = reason; // LLM_UNAVAILABLE_REASON
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

// --- Bezahl-/Guthaben-Fall (GQ-P4/A1) -----------------------------------------------
// Anbieter mit eigenem Bezahl-Status (Telnyx) melden 402. ANTHROPIC NICHT: ein leeres
// Guthaben kommt als HTTP 400 mit error.type "invalid_request_error" - derselbe Typ wie
// jeder Formfehler (am SDK belegt: APIError.generate mappt 400 -> BadRequestError,
// this.type = body.error.type). Am strukturierten Typ allein ist der Fall also NICHT
// erkennbar; genau deshalb fiel er am 04.08. in den generischen Fehlerpfad.
const HTTP_PAYMENT_REQUIRED = 402;

// HTTP-Status eines Anbieter-Fehlers (LLM err.status ODER Telnyx err.providerStatus),
// sonst null. Vorher privat im Telnyx-Shim (vendorStatusOf) - jetzt EINE Quelle (G5)
// neben der Klassifikation, die ihn braucht. Rein.
function providerStatusOf(err) {
  const status = err && (err.providerStatus ?? err.status);
  return typeof status === "number" ? status : null;
}

// "Uns ist beim Anbieter das Geld ausgegangen" als EIGENER Zustand - unabhaengig davon,
// ob der Anbieter ihn als 402 oder als 400 verpackt. Rein (N7), ohne Nebeneffekt; der
// Aufrufer entscheidet, was er damit tut (der Shim: eine Alarm-Zeile, A4). Aendert KEINE
// Degradation, KEIN Retry-Verhalten und KEIN Gate.
//
// Die 402 ist anbieter-UNABHAENGIG (Telnyx meldet sie ueber providerStatus) und bleibt
// deshalb hier; welche EIGENEN Marken ein LLM-Anbieter fuer denselben Fall verwendet,
// weiss nur sein Adapter (llm/ports.js LlmErrorClassification.isBillingError).
export function isProviderBillingError(err) {
  if (!err) return false;
  if (providerStatusOf(err) === HTTP_PAYMENT_REQUIRED) return true;
  return activeLlmErrors().isBillingError(err);
}

// AL-P9/AL-P7: EIN Praedikat "der Versuch war nachweislich auf der Leitung" (G5) - die
// Token-Schaetzung des abgebrochenen Briefings (precall-briefing.js) und die des
// abgerissenen Turn-Streams (claude.js) haengen an derselben Unterscheidung. NUR
// CIRCUIT_OPEN wirft VOR dem Request; jede andere LlmUnavailableError-Ursache hat
// mindestens einen Versuch abgesetzt. Nicht-transiente Fehler (4xx/Auth) sind KEINE
// LlmUnavailableError - der Anbieter weist dort ohne Generierung ab. Fail-safe Richtung:
// im Zweifel buchen (Ueberbuchung statt Loch im Budget-Gate, Regel 1). Rein (N7).
export function attemptReachedProvider(err) {
  return err instanceof LlmUnavailableError && err.reason !== LLM_UNAVAILABLE_REASON.CIRCUIT_OPEN;
}

// "Ist dieser Fehler transient (retrybar)?" - die Klassifikation selbst gehoert dem
// Adapter (llm/ports.js LlmErrorClassification), weil sie Anbieter-Wissen ist. Der
// Bestandsname bleibt hier als Seam-Export stehen: die Retry-ENTSCHEIDUNG faellt in
// diesem Modul, und die Unit-Tests des Seams pinnen ihn.
export const isTransient = (err) => activeLlmErrors().isTransient(err);

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
// kein Rauschen im Breaker-open-/Fehlerpfad (dort gibt es weder eine Antwort noch immer
// einen callId). callId korreliert den Request mit dem Call (PII-frei, wie metrics.logTurn
// schon callId traegt); die Cache-Zaehler kommen aus der neutralen Verbrauchsform
// (LlmTokenUsage) und dienen NUR der Bench-/Latenz-Auswertung (L1) - NIE dem Budget-Gate
// (das bleibt unveraendert an trackUsage haengen).
//
// SCHLUESSELNAMEN bleiben die Anthropic-Namen (test/llm.test.js und test/l0-metrics.test.js
// pinnen den Payload-Schluesselsatz woertlich); ein Rename ist eine eigene Entscheidung.
// Gemeldet wird nur ein Wert > 0: LlmTokenUsage kennt kein "abwesend", 0 heisst dort
// "keine Token dieser Preisklasse" - und genau das ist keine Meldung wert.
function metricsExtra(callId, usage) {
  const extra = {};
  if (callId !== undefined) extra.callId = callId;
  if (usage?.inputCacheWriteTokens) extra.cache_creation_input_tokens = usage.inputCacheWriteTokens;
  if (usage?.inputCacheReadTokens) extra.cache_read_input_tokens = usage.inputCacheReadTokens;
  return extra;
}

// Factory (P15: Konstruktion/Verdrahtung getrennt vom Fachcode). Benannte Felder in
// EINEM Optionsobjekt (F1). messagesCreate/messagesStream sind optionale Test-Seams
// (DIP), die an den Adapter durchgereicht werden; sonst laeuft der echte Prod-Pfad
// (kein toter Code). Welcher Adapter das ist, entscheidet die Registry - ein Adapter
// ignoriert die Seam-Namen, die er nicht kennt.
export function createLlmClient({
  config,
  sleep = defaultSleep,
  metrics = noopMetrics,
  messagesCreate,
  messagesStream,
} = {}) {
  const provider = createLlmProvider({
    requestTimeoutMs: config.llm.llmRequestTimeoutMs,
    messagesCreate,
    messagesStream,
  });
  // Der Client fragt SEINEN Adapter, nicht noch einmal die Registry: eine zweite
  // Aufloesung waere eine zweite Quelle fuer dieselbe Frage (G5). Der Modul-Export
  // isTransient bleibt fuer Aufrufer OHNE Instanz (Seam-Unit-Tests, Bestandsvertrag).
  const providerIsTransient = (err) => provider.errors.isTransient(err);
  const breaker = makeBreaker(
    {
      threshold: config.llm.llmBreakerThreshold,
      windowMs: config.llm.llmBreakerWindowMs,
      cooldownMs: config.llm.llmBreakerCooldownMs,
    },
    Date.now,
  );
  // AL-P7: EIN resilienter Rahmen fuer BEIDE Aufruf-Arten (S2) - Breaker-Vorpruefung,
  // begrenztes selektives Retry, beide Metrik-Emissionen und die Fehler-Klassifikation
  // stehen genau einmal. Die Arten unterscheiden sich nur darin, WAS ein Versuch tut
  // (attempt) und WANN ein Retry noch erlaubt ist (retryable).
  async function runResilient({ callId, attempt, retryable }) {
    if (breaker.isOpen()) {
      metrics.llmCall({
        outcome: "breaker-open",
        attempts: 0,
        breakerState: "open",
        ...metricsExtra(callId),
      });
      throw new LlmUnavailableError(LLM_UNAVAILABLE_REASON.CIRCUIT_OPEN);
    }
    const startedAt = Date.now();
    let attempts = 0;
    try {
      const turn = await withRetry(
        () => {
          attempts += 1;
          return attempt();
        },
        {
          max: config.llm.llmMaxRetries,
          baseMs: config.llm.llmBackoffMs,
          jitter: true,
          retryable,
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
        ...metricsExtra(callId, turn.usage),
      });
      return turn;
    } catch (err) {
      const exhausted = providerIsTransient(err); // transient + durch withRetry geworfen -> Retries erschoepft
      metrics.llmCall({
        outcome: exhausted ? "retries-exhausted" : "non-transient",
        attempts,
        latencyMs: Date.now() - startedAt,
        breakerState: breaker.state(),
        ...metricsExtra(callId),
      });
      if (exhausted) throw new LlmUnavailableError(LLM_UNAVAILABLE_REASON.RETRIES_EXHAUSTED);
      throw err; // nicht-transient (4xx/Auth) unveraendert nach oben
    }
  }

  // I13: callId ist ein additiver Bench-/Metrik-Begleiter, KEIN Anbieter-Request-Feld -
  // er wird hier abgestreift (Rest-Destrukturierung), bevor die Parameter an den Adapter
  // gehen (kein Leak eines unbekannten Feldes in den Provider-Request-Body).
  async function complete({ callId, ...params } = {}) {
    return runResilient({
      callId,
      attempt: () => provider.complete(params),
      retryable: providerIsTransient,
    });
  }

  // AL-P7: dieselbe Resilienz, andere Draht-Form. Der Aufrufer bekommt die Text-Fragmente
  // WAEHREND der Generierung ueber sink (DIP - llm.js kennt weder Saetze noch SSE):
  //   sink.pushText(delta)   jedes Text-Fragment in Reihenfolge
  //   sink.toolUseStarted()  ein Werkzeug-Block hat begonnen (der Abnehmer entscheidet)
  //
  // RESILIENZ-SEMANTIK (bindend): ein Retry ist verboten, sobald das erste Fragment
  // den Seam verlassen hat - gestreamter Text ist nicht zurueckholbar. Davor bleibt der
  // Aufruf idempotent und wird wie bisher selektiv wiederholt. Die Kehrseite ist bewusst:
  // ein transienter Abriss NACH dem ersten Fragment meldet dem Breaker keinen Fehlversuch
  // (withRetry koppelt "retrybar" und "zaehlt fuer den Breaker") - der Breaker bleibt ueber
  // den Nicht-Stream-Pfad und alle frueheren Abrisse gefuettert.
  async function completeStream({ callId, sink, streamBudgetMs, ...params } = {}) {
    let forwardedText = false;
    // Der Merker gehoert dem SEAM (llm/ports.js): der Adapter sieht nur diesen Sink und
    // bringt keine eigene Stream-Schleife mit Wiederholung mit. Er kippt bei JEDEM
    // Fragment - auch beim Fugenzeichen zwischen zwei Textbloecken, das den Seam ebenso
    // verlaesst wie ein Text-Delta.
    const guardedSink = {
      pushText: (delta) => {
        forwardedText = true;
        sink.pushText(delta);
      },
      toolUseStarted: () => sink.toolUseStarted(),
    };
    const attempt = async () => {
      // WANDUHR des AUFRUFERS, je Versuch frisch armiert: der Per-Request-Timeout des
      // Anbieters deckt bei stream:true NUR die Zeit bis zu den Antwort-Headern - die
      // Generierung selbst liefe sonst unbegrenzt weiter und der Turn hinge bis zum
      // Dead-Air-Watchdog. Massstab ist die Restfrist des Tool-Loops (AL-P6).
      const deadline = AbortSignal.timeout(streamBudgetMs);
      try {
        return await provider.completeStream({ ...params, signal: deadline }, guardedSink);
      } catch (err) {
        // NUR unsere eigene Uhr macht aus einem Abriss einen STREAM_ABORTED - dafuer
        // braucht der Seam keinen Anbieter-Fehlertyp.
        if (deadline.aborted) throw new LlmUnavailableError(LLM_UNAVAILABLE_REASON.STREAM_ABORTED);
        throw err;
      }
    };
    return runResilient({
      callId,
      attempt,
      retryable: (err) => !forwardedText && providerIsTransient(err),
    });
  }

  return { complete, completeStream };
}
