// Direkte ElevenLabs-TTS-Synthese, GESTREAMT. Reine, IO-injizierte Funktion (DIP wie
// src/llm.js): fetchImpl kommt vom Aufrufer, keine globale Abhaengigkeit ->
// deterministisch testbar mit Fake-fetch. Wirft NIE - jeder Fehler kommt als {ok:false}
// zurueck, damit ein datengetriebenes TTS-Gate kein laufendes Gespraech toetet
// (fail-safe, NICHT fail-closed). Der API-Key wird NIE geloggt und NIE in reason
// zurueckgegeben (Regel 4/Secrets); reason ist ein grober Code.
//
// WARUM GESTREAMT (IE7): am 2026-09-13 mit demselben Text, derselben Stimme und
// demselben Modell gemessen - Vollabruf 2596-6370 ms, erstes Paket des
// Streaming-Endpunkts 351-391 ms. Der Aufrufer wartet seit IE7 nur noch auf DIESES
// erste Paket; damit steht fest, dass der Anbieter liefert, und die Entscheidung
// <Play> gegen Azure-<Say> faellt weiterhin VOR dem Rendern. Der Rest laeuft danach im
// Hintergrund in denselben Puffer.
//
// output_format ist bei ElevenLabs ein QUERY-Parameter (nicht im Body).
const TTS_PATH = "/v1/text-to-speech/";
const TTS_STREAM_SUFFIX = "/stream";
const DEFAULT_CONTENT_TYPE = "audio/mpeg";
const DETAIL_MAX_CHARS = 300;

// Der EINE Abbruch-Griff dieses Aufrufs: Frist setzen, Frist ersetzen, am Ende abraeumen.
// Ohne ihn braeuchte jeder Rueckgabepfad sein eigenes clearTimeout (G5) - und genau dort
// vergisst man eines.
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

// ElevenLabs-Fehlerdetail (JSON mit status/message, KEIN gesprochener Text/Secret) fuer
// die Diagnose mitgeben, gekappt. res.text kann im Test fehlen -> defensiv.
async function errorDetail(res) {
  if (typeof res.text !== "function") return "";
  const body = await res.text().catch(() => "");
  return body.slice(0, DETAIL_MAX_CHARS);
}

// Der Rest des Stroms, im Hintergrund in denselben Puffer. LEHNT NIE ab: bricht der Strom
// (Netzfehler oder Abbruch an der Gesamtfrist), loest er mit dem bisher Empfangenen auf -
// das ist mindestens das erste Paket, also NIE Stille (IE7-Invariante). complete=false
// macht den Abbruch sichtbar, statt ihn zu verschlucken.
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

// Die Anbieter-Naht: ruft den Streaming-Endpunkt und liefert den Leser des Audio-Stroms -
// oder den Grund, warum es keinen gibt. Die Frist haelt der Aufrufer (EIN Abbruch-Griff);
// hier steht nur, was der Anbieter antwortet.
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

/**
 * Synthetisiert `text` und kehrt zurueck, sobald das ERSTE Audio-Paket vorliegt.
 * @param {string} text
 * @param {object} opts fetchImpl, apiKey, voiceId, model, apiBase, outputFormat,
 *   firstChunkTimeoutMs (Frist bis zum ersten Paket), totalTimeoutMs (Gesamtfrist des
 *   Stroms, ab Aufrufbeginn; liegt sie unter firstChunkTimeoutMs, bricht der Strom
 *   direkt nach dem ersten Paket ab - kein Sonderfall, kein Absturz).
 * @returns {Promise<{ok: true, contentType: string, firstChunkMs: number,
 *   audio: Promise<{bytes: Buffer, totalMs: number, complete: boolean}>}
 *   | {ok: false, reason: string, detail?: string}>}
 *   `audio` lehnt NIE ab und traegt immer mindestens das erste Paket.
 */
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
    // Das Gate, das ein leeres <Play> unmoeglich macht: ohne erstes Paket entsteht gar
    // keine Serve-URL, der Aufrufer faellt auf Azure-<Say> zurueck.
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
