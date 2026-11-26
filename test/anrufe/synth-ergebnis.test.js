import assert from "node:assert/strict";
import { test } from "node:test";

import { makeAusgabeWaechter } from "../../scripts/iel-geheimnisse-ausgabe.mjs";
import { stimmenBeleg } from "../../scripts/iel-geheimnisse-belege.mjs";
import { erzeugeVorspann } from "../../src/elevenlabs/vorspann-erzeugen.js";
import { VORSPANN_MIN_BYTES_JE_ZEICHEN } from "../../src/elevenlabs/vorspann-pruefung.js";

const PFLICHTSATZ = "Hier spricht eine KI.";
const EROEFFNUNG = { text: `${PFLICHTSATZ} Es geht um Y.`, pflichtsatz: PFLICHTSATZ, voiceId: "stimme" };
const CONTENT_TYPE = "audio/ogg";
const BYTES = Buffer.alloc(VORSPANN_MIN_BYTES_JE_ZEICHEN * EROEFFNUNG.text.length, 1);

const geglueckt = (audio) => ({ ok: true, wert: { contentType: CONTENT_TYPE, firstChunkMs: 1, audio: Promise.resolve(audio) } });
const vorspannAus = (ergebnis) => erzeugeVorspann({ eroeffnung: EROEFFNUNG, synthese: async () => ergebnis });

test("synth-ergebnis: ein geglücktes Synthese-Ergebnis liefert den Vorspann mit Text, Bytes und Content-Type", async () => {
  assert.deepEqual(await vorspannAus(geglueckt({ complete: true, bytes: BYTES })), {
    text: EROEFFNUNG.text,
    audio: { bytes: BYTES, contentType: CONTENT_TYPE },
  });
});

test("synth-ergebnis: ein geglücktes Ergebnis mit abgebrochenem Audio meldet tts_unvollstaendig", async () => {
  assert.deepEqual(await vorspannAus(geglueckt({ complete: false, bytes: BYTES })), { rueckfall: "tts_unvollstaendig" });
});

test("synth-ergebnis: ein Fehler-Ergebnis mit Grund als Text meldet tts_fehler", async () => {
  assert.deepEqual(await vorspannAus({ ok: false, fehler: "timeout" }), { rueckfall: "tts_fehler" });
});

test("synth-ergebnis: ein Fehler-Ergebnis mit Grund und Detail meldet tts_fehler", async () => {
  assert.deepEqual(await vorspannAus({ ok: false, fehler: { reason: "http_503", detail: "weg" } }), {
    rueckfall: "tts_fehler",
  });
});

const EL_BASIS = "http://el.test";
const TTS_PFAD = "/v1/text-to-speech/";
const STIMME = "cqPdIo76zSHFDcSZpFov";
const HTTP_OK = 200;
const HTTP_ABGELEHNT = 401;

const jsonAntwort = (koerper) =>
  new Response(JSON.stringify(koerper), { status: HTTP_OK, headers: { "content-type": "application/json" } });

async function probeZeile(synthese) {
  const fetchImpl = async (adresse) => {
    const url = String(adresse);
    if (url.includes(TTS_PFAD)) return synthese();
    if (url.includes("/env-vars/ELEVENLABS_VOICE_ID")) return jsonAntwort({ value: STIMME });
    if (url.includes("/v1/convai/agents/")) {
      return jsonAntwort({ conversation_config: { tts: { voice_id: STIMME, model_id: "modell" } } });
    }
    return jsonAntwort({});
  };
  const zeilen = [];
  const kanal = { write: (zeile) => zeilen.push(zeile) };
  const { gruen } = await stimmenBeleg({
    fetchImpl,
    waechter: makeAusgabeWaechter({ stdout: kanal, stderr: kanal }),
    renderApiKey: "render-test",
    elKonto: { apiKey: "el-test", apiBase: EL_BASIS, agentId: "agent-test" },
    ttsAusgabeformat: "mp3_44100_128",
  });
  return { gruen, zeile: zeilen.find((zeile) => zeile.includes("STIMMEN (a)")).trim() };
}

test("synth-ergebnis: der Stimmen-Beleg nennt bei abgelehnter Probe den HTTP-Status und bleibt rot", async () => {
  assert.deepEqual(await probeZeile(() => new Response("nein", { status: HTTP_ABGELEHNT })), {
    gruen: false,
    zeile: `[iel-geheimnisse] STIMMEN (a) Profil-Stimme ${STIMME}: Probe-Synthese Status 401`,
  });
});

test("synth-ergebnis: der Stimmen-Beleg nennt Status 0, wenn die Probe ohne HTTP-Antwort scheitert", async () => {
  const netzWeg = () => {
    throw new Error("netz weg");
  };
  assert.deepEqual(await probeZeile(netzWeg), {
    gruen: false,
    zeile: `[iel-geheimnisse] STIMMEN (a) Profil-Stimme ${STIMME}: Probe-Synthese Status 0`,
  });
});
