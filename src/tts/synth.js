// Direkte ElevenLabs-TTS-Synthese (Owner-Wahl Option A). Reine, IO-injizierte Funktion
// (DIP wie src/llm.js): fetchImpl kommt vom Aufrufer, keine globale Abhaengigkeit ->
// deterministisch testbar mit Fake-fetch. Wirft NIE - jeder Fehler wird als
// {ok:false} zurueckgegeben, damit ein datengetriebenes TTS-Gate kein laufendes
// Gespraech toetet (fail-safe, NICHT fail-closed). Der API-Key wird NIE geloggt und
// NIE in reason zurueckgegeben (Regel 4/Secrets); reason ist ein grober Code.
// output_format ist bei ElevenLabs ein QUERY-Parameter (nicht im Body) - eine
// bewusste Korrektur der Handoff-Wortwahl gegen die reale API; im Owner-Probe-Anruf
// zu bestaetigen.
const TTS_PATH = "/v1/text-to-speech/";

export async function synthesizeSpeech(text, opts) {
  const { fetchImpl, apiKey, voiceId, model, apiBase, outputFormat, timeoutMs } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      apiBase +
      TTS_PATH +
      encodeURIComponent(voiceId) +
      "?output_format=" +
      encodeURIComponent(outputFormat);
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // ElevenLabs-Fehlerdetail (JSON mit status/message, KEIN gesprochener Text/Secret)
      // fuer die Diagnose mitgeben, gekappt. res.text kann im Test fehlen -> defensiv.
      const detail = typeof res.text === "function" ? (await res.text().catch(() => "")).slice(0, 300) : "";
      return { ok: false, reason: `http_${res.status}`, detail };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { ok: true, bytes, contentType: res.headers.get("content-type") || "audio/mpeg" };
  } catch (err) {
    return { ok: false, reason: err && err.name === "AbortError" ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}
