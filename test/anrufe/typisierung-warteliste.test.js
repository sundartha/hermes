import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const karte = JSON.parse(readFileSync(fileURLToPath(new URL("../../tools/bereiche.json", import.meta.url)), "utf8"));
const quellen = karte.find((eintrag) => eintrag.bereich === "anrufe").quellen.map((muster) => new RegExp(muster));

const GROSS = "über 200 Zeilen: eigenes Häppchen, nicht im Häppchen 2 von #3412";
const FOLGE = "Umstellung folgt als eigenes TS-Paket, Häppchen 2 von #3412 bleibt unter 200 Zeilen";

const WARTELISTE = {
  "src/claude.js": GROSS,
  "src/conversation/consult-raised.js": FOLGE,
  "src/elevenlabs/inbound-initiation.js": FOLGE,
  "src/elevenlabs/init-webhook-ziel.js": FOLGE,
  "src/elevenlabs/kosten-beleg.js": FOLGE,
  "src/elevenlabs/nummern-registrierung.js": FOLGE,
  "src/elevenlabs/opening-line-llm.js": FOLGE,
  "src/elevenlabs/outbound-vorspann.js": FOLGE,
  "src/elevenlabs/outbound.js": GROSS,
  "src/elevenlabs/vorspann-ablauf.js": GROSS,
  "src/elevenlabs/vorspann-bruecke.js": FOLGE,
  "src/elevenlabs/vorspann-erzeugen.js": FOLGE,
  "src/elevenlabs/vorspann-fristen.js": FOLGE,
  "src/elevenlabs/vorspann-ohne-zustand.js": FOLGE,
  "src/elevenlabs/vorspann-pruefung.js": FOLGE,
  "src/llm.js": GROSS,
  "src/llm/registry.js": FOLGE,
  "src/precall-briefing.js": GROSS,
  "src/research/adapters/exa-search.js": FOLGE,
  "src/research/in-call.js": FOLGE,
  "src/research/registry.js": FOLGE,
  "src/telephony/adapters/telnyx/config-read.js": FOLGE,
  "src/telephony/adapters/telnyx/messaging.js": FOLGE,
  "src/telephony/adapters/telnyx/numbers.js": FOLGE,
  "src/telephony/adapters/telnyx/voice.js": GROSS,
  "src/telephony/adapters/telnyx/webhook-events.js": FOLGE,
  "src/telephony/call-finish.js": GROSS,
  "src/telephony/outage-report.js": GROSS,
  "src/telephony/outbound-gates.js": GROSS,
  "src/telephony/registry.js": FOLGE,
  "src/telephony/voice-render.js": FOLGE,
  "src/tts/directive-synth.js": FOLGE,
};

function dateienDesBereichs() {
  return execFileSync("git", ["ls-files", "src"], { cwd: WURZEL, encoding: "utf8" })
    .split("\n")
    .filter((pfad) => quellen.some((muster) => muster.test(pfad)));
}

test("Bereich anrufe: jede JavaScript-Datei steht mit Grund auf der Warteliste", () => {
  const abweichungen = dateienDesBereichs().filter((pfad) => /\.(js|mjs|cjs)$/.test(pfad));
  assert.deepEqual(abweichungen.toSorted(), Object.keys(WARTELISTE).toSorted());
});

test("Bereich anrufe: die umgestellten Dateien sind .ts", () => {
  const dateien = dateienDesBereichs();
  assert.ok(dateien.includes("src/elevenlabs/uebergabe-override.ts"));
  assert.ok(dateien.includes("src/telephony/call-control-ereignis.ts"));
  assert.ok(dateien.includes("src/telephony/ausgabenwarnung.ts"));
});
