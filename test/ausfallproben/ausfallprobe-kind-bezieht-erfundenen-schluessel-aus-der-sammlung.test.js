import { test } from "node:test";
import assert from "node:assert/strict";
import * as geheimnisse from "../gemeinsam/erfundene-geheimnisse.js";
import { kindUmgebung } from "../../scripts/ausfallproben/hermes-kind.mjs";

const UMGEBUNG = kindUmgebung({
  weicheUrl: "http://127.0.0.1:1",
  datenVerzeichnis: "/tmp/ausfallprobe-daten",
  port: 4000,
});

test("Ausfallprobe-Kind: Anbieter-Schluessel kommen aus der Sammlung erfundener Geheimnisse", () => {
  const wert = geheimnisse.AUSFALLPROBE_SCHLUESSEL;
  assert.equal(wert, "ausfallprobe-erfunden-nicht-echt");
  for (const name of ["ANTHROPIC_API_KEY", "TELNYX_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_INBOUND_SIP_PASSWORD"]) {
    assert.equal(UMGEBUNG[name], wert, name);
  }
  assert.equal(UMGEBUNG.SESSION_SECRET, wert + wert);
  assert.equal(UMGEBUNG.ELEVENLABS_INIT_WEBHOOK_TOKEN, wert + wert);
  assert.ok(UMGEBUNG.SESSION_SECRET.length >= 32);
});
