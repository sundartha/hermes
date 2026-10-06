import { activeLlmErrors, createLlmProvider } from "./llm/registry.js";

const BACKOFF_FACTOR = 2;

export const LLM_UNAVAILABLE_REASON = Object.freeze({
  CIRCUIT_OPEN: "circuit-open",
  RETRIES_EXHAUSTED: "retries-exhausted",
  STREAM_ABORTED: "stream-aborted",
});

export class LlmUnavailableError extends Error {
  constructor(reason) {
    super(`LLM nicht verfuegbar: ${reason}`);
    this.name = "LlmUnavailableError";
    this.reason = reason;
  }
}

export function degradedSpeechFor(err, locale) {
  return err instanceof LlmUnavailableError ? locale.llmDegradedSpeech : locale.turnErrorSpeech;
}

const HTTP_PAYMENT_REQUIRED = 402;

function providerStatusOf(err) {
  const status = err && (err.providerStatus ?? err.status);
  return typeof status === "number" ? status : null;
}

export function isProviderBillingError(err) {
  if (!err) return false;
  if (providerStatusOf(err) === HTTP_PAYMENT_REQUIRED) return true;
  return activeLlmErrors().isBillingError(err);
}

export function attemptReachedProvider(err) {
  return err instanceof LlmUnavailableError && err.reason !== LLM_UNAVAILABLE_REASON.CIRCUIT_OPEN;
}

export const isTransient = (err) => activeLlmErrors().isTransient(err);

function backoffDelay({ baseMs, attempt, jitter, random }) {
  const exp = baseMs * BACKOFF_FACTOR ** attempt;
  return jitter ? Math.floor(random() * exp) : exp;
}

function makeBreaker({ threshold, windowMs, cooldownMs }, now) {
  let failures = [];
  let state = "closed";
  let openedAt = 0;
  return {
    state: () => state,
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
      if (!transient || attempt >= max) throw err;
      const delay = backoffDelay({ baseMs, attempt, jitter, random });
      attempt += 1;
      await sleep(delay);
    }
  }
}

const noopMetrics = { llmCall() {} };
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function metricsExtra(callId, usage) {
  const extra = {};
  if (callId !== undefined) extra.callId = callId;
  if (usage?.inputUncachedTokens) extra.input_tokens = usage.inputUncachedTokens;
  if (usage?.inputCacheWriteTokens) extra.cache_creation_input_tokens = usage.inputCacheWriteTokens;
  if (usage?.inputCacheReadTokens) extra.cache_read_input_tokens = usage.inputCacheReadTokens;
  if (usage?.outputTokens) extra.output_tokens = usage.outputTokens;
  return extra;
}

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
  const providerIsTransient = (err) => provider.errors.isTransient(err);
  const breaker = makeBreaker(
    {
      threshold: config.llm.llmBreakerThreshold,
      windowMs: config.llm.llmBreakerWindowMs,
      cooldownMs: config.llm.llmBreakerCooldownMs,
    },
    Date.now,
  );
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
      const exhausted = providerIsTransient(err);
      metrics.llmCall({
        outcome: exhausted ? "retries-exhausted" : "non-transient",
        attempts,
        latencyMs: Date.now() - startedAt,
        breakerState: breaker.state(),
        ...metricsExtra(callId),
      });
      if (exhausted) throw new LlmUnavailableError(LLM_UNAVAILABLE_REASON.RETRIES_EXHAUSTED);
      throw err;
    }
  }

  async function complete({ callId, ...params } = {}) {
    return runResilient({
      callId,
      attempt: () => provider.complete(params),
      retryable: providerIsTransient,
    });
  }

  async function completeStream({ callId, sink, streamBudgetMs, ...params } = {}) {
    let forwardedText = false;
    const guardedSink = {
      pushText: (delta) => {
        forwardedText = true;
        sink.pushText(delta);
      },
      toolUseStarted: () => sink.toolUseStarted(),
    };
    const attempt = async () => {
      const deadline = AbortSignal.timeout(streamBudgetMs);
      try {
        return await provider.completeStream({ ...params, signal: deadline }, guardedSink);
      } catch (err) {
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

export function createSecondaryLlmClient({ config, requestTimeoutMs, maxRetries, metrics }) {
  return createLlmClient({
    config: {
      llm: {
        llmRequestTimeoutMs: requestTimeoutMs,
        llmMaxRetries: maxRetries,
        llmBackoffMs: config.llm.llmBackoffMs,
        llmBreakerThreshold: config.llm.llmBreakerThreshold,
        llmBreakerWindowMs: config.llm.llmBreakerWindowMs,
        llmBreakerCooldownMs: config.llm.llmBreakerCooldownMs,
      },
    },
    metrics,
  });
}
