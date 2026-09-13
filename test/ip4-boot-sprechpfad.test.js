// IP4 Scope 2: die Boot-Zeile, die sagt, welchen Inbound-Sprechpfad diese Instanz scharf
// hat. Zwei Ebenen (Muster test/al-p16-boot-probes.test.js):
//   (a) die reine Funktion in BEIDEN Richtungen - eine Sonde, die nur den Gutfall zeigt,
//       meldet den Ausfall nie;
//   (b) EIN Spawn, der genau das pinnt, was diese Phase neu behauptet: die Zeile LUEGT
//       NICHT. Kein zweiter azure_say-Pin (den haelt test/ip2-sprechpfad-klassifikation.js);
//       hier wird die Boot-AUSSAGE gegen das GERENDERTE TeXML DESSELBEN Servers gemessen.
//
// KEIN KATALOG-ID-PRAEFIX am Testnamen ("IP4" steht nicht im Muster
// package.json#config.i18nCatalogPattern): diese Faelle gehoeren in die Regressionsbank.
import { test } from "node:test";
import assert from "node:assert/strict";

import { inboundSprechpfadBannerLine } from "../src/boot.js";
import { classifySprechpfad, SPRECHPFAD } from "../src/telephony/sprechpfad.js";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming } from "./helpers.js";

const HTTP_OK = 200;
const RUECKFALL_HINWEIS =
  "play_tts faellt bei erschoepftem Kontingent, Synthese-Fehler oder Anbieter ohne Play-Audio" +
  " fail-safe auf azure_say zurueck";
// Der gemeldete Pfad-Token aus dem Boot-Log. Als Quelltext statt als RegExp-Objekt:
// daraus entstehen unten zwei Regexe (zaehlen mit /g, lesen ohne) ohne geteilten
// lastIndex-Zustand.
const SPRECHPFAD_ZEILE = "Inbound-Sprechpfad: (\\w+) \\(";

function bannerZeile(enabled) {
  return inboundSprechpfadBannerLine({ elevenLabsPlayTts: { enabled } });
}

test("IP4-1: die Boot-Zeile nennt bei Flag AUS azure_say", () => {
  assert.equal(
    bannerZeile(false),
    `Inbound-Sprechpfad: azure_say (ELEVENLABS_PLAY_TTS_ENABLED=false) - ${RUECKFALL_HINWEIS}`,
  );
});

test("IP4-2: die Boot-Zeile nennt bei Flag AN play_tts", () => {
  assert.equal(
    bannerZeile(true),
    `Inbound-Sprechpfad: play_tts (ELEVENLABS_PLAY_TTS_ENABLED=true) - ${RUECKFALL_HINWEIS}`,
  );
});

test("IP4-3: die Zeile folgt der AUFGELOESTEN Konfiguration, NICHT der Rohumgebung", () => {
  // Die Umgebung wird auf das GEGENTEIL gestellt: eine Zeile, die process.env liest,
  // meldet dann den falschen Pfad (Muster AL-P16-7).
  const vorher = process.env.ELEVENLABS_PLAY_TTS_ENABLED;
  process.env.ELEVENLABS_PLAY_TTS_ENABLED = "true";
  try {
    assert.match(bannerZeile(false), /Inbound-Sprechpfad: azure_say \(/);
  } finally {
    if (vorher === undefined) delete process.env.ELEVENLABS_PLAY_TTS_ENABLED;
    else process.env.ELEVENLABS_PLAY_TTS_ENABLED = vorher;
  }
});

test("IP4-4: die Boot-Zeile stimmt mit dem TeXML ueberein, das derselbe Server rendert", async () => {
  const srv = await startServer({ seed: seedWithTelnyxNumber({ language: "de" }) });
  try {
    // Der Anruf zuerst: startServer loest auf der Gateway-Zeile auf, die Banner-Zeilen
    // stehen DAHINTER - der Roundtrip laesst sie eintreffen (Muster AL-P16-9).
    const res = await postTelnyxIncoming(srv, { callSid: "CAip4boot" });
    assert.equal(res.status, HTTP_OK);
    const texml = await res.text();

    const treffer = srv.stdout.match(new RegExp(SPRECHPFAD_ZEILE, "g"));
    assert.equal(treffer?.length, 1, `genau EINE Sprechpfad-Zeile erwartet:\n${srv.stdout}`);
    const gemeldet = treffer[0].match(new RegExp(SPRECHPFAD_ZEILE))[1];

    assert.equal(classifySprechpfad(texml), gemeldet);
    assert.equal(gemeldet, SPRECHPFAD.AZURE_SAY, "Repo-Defaults: Flag aus");
  } finally {
    await srv.stop();
  }
});
