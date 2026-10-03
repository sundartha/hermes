import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startServer,
  startServerExpectExit,
  placeCall,
  seedState,
  seedCall,
  anthropicAttrappe,
  TELNYX_TEST_OWNER_NUMBER,
} from "./helpers.js";

const HTTP_OK = 200;
const BEOBACHTER = fileURLToPath(new URL("./helpers/netz-beobachter.cjs", import.meta.url));
const EL_ERGEBNISABRUF = "/v1/convai/conversations/conv_ohne_internet";

const EL_ANRUFWEG = Object.freeze({
  FAKE_ORIGINATE_ELEVENLABS: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_x",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phone_x",
  ELEVENLABS_API_KEY: "key_x",
});

const laufenderElAnruf = seedCall({
  id: "call_ohne_internet",
  status: "active",
  direction: "outbound",
  maxDurationS: 600,
  answeredAt: new Date().toISOString(),
  elevenlabsConversationId: "conv_ohne_internet",
});

function beobachterUmgebung() {
  const protokoll = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "netz-")), "netz.jsonl");
  const env = {
    NODE_OPTIONS: `--require "${BEOBACHTER}"`,
    NETZ_BEOBACHTER_LOG: protokoll,
  };
  return { env, eintraege: () => leseProtokoll(protokoll) };
}

function leseProtokoll(protokoll) {
  if (!fs.existsSync(protokoll)) return [];
  const zeilen = fs.readFileSync(protokoll, "utf8").split("\n");
  return zeilen.filter(Boolean).map((zeile) => JSON.parse(zeile));
}

function pruefeNurLokal(eintraege) {
  assert.ok(
    eintraege.some((eintrag) => eintrag.art === "start"),
    "Beobachter im Server nicht geladen",
  );
  assert.deepEqual(
    eintraege.filter((eintrag) => eintrag.extern),
    [],
    "Ziel ausserhalb dieses Rechners angesprochen",
  );
  assert.deepEqual(
    eintraege.filter((eintrag) => eintrag.art === "env-datei"),
    [],
    "Server hat versucht, eine .env zu lesen",
  );
}

test("Testserver aus startServer spricht beim Anruf ueber ElevenLabs nur Ziele auf diesem Rechner an", async () => {
  const beobachter = beobachterUmgebung();
  const anfragenVorher = anthropicAttrappe.anfragen();
  const srv = await startServer({
    env: { ...EL_ANRUFWEG, ...beobachter.env },
    seed: seedState({ calls: [laufenderElAnruf] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, HTTP_OK);
  } finally {
    await srv.stop();
  }
  const eintraege = beobachter.eintraege();
  assert.ok(
    eintraege.some((eintrag) => eintrag.art === "abruf" && eintrag.ziel.endsWith(EL_ERGEBNISABRUF)),
    "Ergebnisabruf bei ElevenLabs nicht versucht",
  );
  pruefeNurLokal(eintraege);
  assert.ok(anthropicAttrappe.anfragen() > anfragenVorher, "Anthropic-Attrappe nicht angefragt");
  const { usage } = srv.readStore();
  assert.equal(usage.owner.outputTokens, 0, "Ablehnung des Anbieters wurde gebucht");
});

test("Testserver aus startServerExpectExit liest keine .env und spricht nur Ziele auf diesem Rechner an", async () => {
  const beobachter = beobachterUmgebung();
  const { code } = await startServerExpectExit({
    env: { LLM_PROVIDER: "unbekannt", ...beobachter.env },
  });
  assert.notEqual(code, 0);
  pruefeNurLokal(beobachter.eintraege());
});
