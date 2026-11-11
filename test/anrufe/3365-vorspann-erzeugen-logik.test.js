import { mock, test } from "node:test";
import assert from "node:assert/strict";

import {
  erzeugeVorspann,
  meldeVorspannBereit,
  meldeVorspannRueckfall,
} from "../../src/elevenlabs/vorspann-erzeugen.js";
import { VORSPANN_MIN_BYTES_JE_ZEICHEN } from "../../src/elevenlabs/vorspann-pruefung.js";
import { echtWarten } from "../echt-warten.js";

const KURZE_FRIST_MS = 20;
const HAENGT_UEBER_DIE_FRIST_MS = 50;
const PFLICHTSATZ = "Hier spricht eine KI.";
const EROEFFNUNG = { text: `${PFLICHTSATZ} Es geht um X.`, pflichtsatz: PFLICHTSATZ, voiceId: "stimme" };
const CONTENT_TYPE = "audio/mpeg";
const mindestBytes = (zeichen) => Buffer.alloc(VORSPANN_MIN_BYTES_JE_ZEICHEN * zeichen);

const bereitesAudio = () => ({ complete: true, bytes: mindestBytes(EROEFFNUNG.text.length) });
const synthese = (ergebnis) => mock.fn(async () => ergebnis);
const lieferAudio = (audio = bereitesAudio()) => ({ ok: true, contentType: CONTENT_TYPE, audio: Promise.resolve(audio) });

const ERZEUGEN_TABELLE = [
  ["Synthese scheitert", { ok: false, reason: "http_503" }, "tts_fehler"],
  ["Synthese scheitert trotz vorhandenem Audio", { ...lieferAudio(), ok: false }, "tts_fehler"],
  ["Quote erschoepft", { quotaErschoepft: true }, "tts_quote"],
  ["Audio unvollstaendig", lieferAudio({ complete: false, bytes: mindestBytes(EROEFFNUNG.text.length) }), "tts_unvollstaendig"],
  ["Audio zu kurz", lieferAudio({ complete: true, bytes: Buffer.alloc(1) }), "tts_unplausibel"],
];

for (const [name, ergebnis, erwartet] of ERZEUGEN_TABELLE)
  test(`3365-K5: Vorspann erzeugen - ${name} -> ${erwartet}`, async () => {
    assert.deepEqual(await erzeugeVorspann({ eroeffnung: EROEFFNUNG, synthese: synthese(ergebnis) }), {
      rueckfall: erwartet,
    });
  });

test("3365-K5: Vorspann erzeugen - Synthese wirft -> tts_fehler", async () => {
  const wirft = async () => Promise.reject(new Error("kaputt"));
  assert.deepEqual(await erzeugeVorspann({ eroeffnung: EROEFFNUNG, synthese: wirft }), { rueckfall: "tts_fehler" });
});

test("3365-K5: Vorspann erzeugen - Audio-Strom bricht ab -> tts_fehler", async () => {
  const brichtAb = { ok: true, audio: Promise.reject(new Error("Strom abgebrochen")) };
  assert.deepEqual(await erzeugeVorspann({ eroeffnung: EROEFFNUNG, synthese: synthese(brichtAb) }), {
    rueckfall: "tts_fehler",
  });
});

test("3365-K5: Vorspann erzeugen - Synthese haengt -> tts_frist nach Ablauf der Frist", async () => {
  const haengt = () => echtWarten(HAENGT_UEBER_DIE_FRIST_MS).then(() => new Promise(() => {}));
  const beginn = Date.now();
  const ergebnis = await erzeugeVorspann({ eroeffnung: EROEFFNUNG, synthese: haengt, fristMs: KURZE_FRIST_MS });
  assert.deepEqual(ergebnis, { rueckfall: "tts_frist" });
  assert.ok(Date.now() - beginn >= KURZE_FRIST_MS - 1, "kein vorzeitiger Rueckfall");
});

test("3365-K3: Vorspann erzeugen - gelungene Synthese liefert Text und Audio samt Content-Type, gesprochen wird genau die Eroeffnung", async () => {
  const fertig = synthese(lieferAudio());
  const ergebnis = await erzeugeVorspann({ eroeffnung: EROEFFNUNG, synthese: fertig });
  assert.deepEqual(ergebnis, {
    text: EROEFFNUNG.text,
    audio: { bytes: bereitesAudio().bytes, contentType: CONTENT_TYPE },
  });
  const [aufruf] = fertig.mock.calls;
  assert.deepEqual(aufruf.arguments, [EROEFFNUNG.text, EROEFFNUNG.voiceId]);
});

const OHNE_SYNTHESE_TABELLE = [
  ["Eroeffnung ohne Pflichtsatz am Anfang", { ...EROEFFNUNG, text: `Guten Tag. ${EROEFFNUNG.text}` }, "eroeffnung"],
  ["leere Eroeffnung", { ...EROEFFNUNG, text: "" }, "eroeffnung"],
  ["keine Stimme", { ...EROEFFNUNG, voiceId: "" }, "tts_fehler"],
];

for (const [name, eroeffnung, erwartet] of OHNE_SYNTHESE_TABELLE)
  test(`3365-K3: Vorspann erzeugen - ${name} -> ${erwartet}, ohne TTS-Aufruf`, async () => {
    const aufgerufen = synthese(lieferAudio());
    assert.deepEqual(await erzeugeVorspann({ eroeffnung, synthese: aufgerufen }), { rueckfall: erwartet });
    assert.equal(aufgerufen.mock.callCount(), 0);
  });

test("3365-K23: die Logzeilen nennen nur Grund und Anruf-Kennung", (t) => {
  const log = t.mock.method(console, "log", () => {});
  meldeVorspannRueckfall({ callId: "call_1", grund: "tts_quote" });
  meldeVorspannBereit("call_2");
  assert.deepEqual(
    log.mock.calls.map((aufruf) => aufruf.arguments),
    [["[el-vorspann] rueckfall grund=tts_quote call=call_1"], ["[el-vorspann] bereit call=call_2"]],
  );
});
