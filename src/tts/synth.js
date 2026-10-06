const TTS_PATH = "/v1/text-to-speech/";
const TTS_STREAM_SUFFIX = "/stream";
const DEFAULT_CONTENT_TYPE = "audio/mpeg";
const DETAIL_MAX_CHARS = 300;

function makeDeadline(controller) {
  let timer = null;
  return {
    arm(ms) {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), ms);
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

function streamUrl({ apiBase, voiceId, outputFormat }) {
  return (
    `${apiBase}${TTS_PATH}${encodeURIComponent(voiceId)}${TTS_STREAM_SUFFIX}` +
    `?output_format=${encodeURIComponent(outputFormat)}`
  );
}

async function errorDetail(res) {
  if (typeof res.text !== "function") return "";
  const body = await res.text().catch(() => "");
  return body.slice(0, DETAIL_MAX_CHARS);
}

async function drainRest({ reader, firstChunk, startedAt, deadline }) {
  const chunks = [firstChunk];
  let complete = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) chunks.push(value);
    }
  } catch {
    complete = false;
  } finally {
    deadline.clear();
  }
  return { bytes: Buffer.concat(chunks), totalMs: Date.now() - startedAt, complete };
}

async function openAudioStream(text, opts, signal) {
  const { fetchImpl, apiKey, model } = opts;
  const res = await fetchImpl(streamUrl(opts), {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model }),
    signal,
  });
  if (!res.ok) return { ok: false, reason: `http_${res.status}`, detail: await errorDetail(res) };
  const reader = res.body?.getReader?.();
  if (!reader) return { ok: false, reason: "no_stream" };
  return { ok: true, reader, contentType: res.headers.get("content-type") || DEFAULT_CONTENT_TYPE };
}

export async function synthesizeSpeechStream(text, opts) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const deadline = makeDeadline(controller);
  deadline.arm(opts.firstChunkTimeoutMs);
  try {
    const stream = await openAudioStream(text, opts, controller.signal);
    if (!stream.ok) {
      deadline.clear();
      return stream;
    }
    const first = await stream.reader.read();
    deadline.clear();
    if (first.done || !first.value?.length) return { ok: false, reason: "empty_stream" };
    deadline.arm(Math.max(0, opts.totalTimeoutMs - (Date.now() - startedAt)));
    return {
      ok: true,
      contentType: stream.contentType,
      firstChunkMs: Date.now() - startedAt,
      audio: drainRest({ reader: stream.reader, firstChunk: first.value, startedAt, deadline }),
    };
  } catch (err) {
    deadline.clear();
    return { ok: false, reason: err && err.name === "AbortError" ? "timeout" : "error" };
  }
}
