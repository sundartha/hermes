import { test } from "node:test";
import assert from "node:assert/strict";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { initInhaltFuer, vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const FALLBACK_DE = "Ich rufe an, um ein kurzes Anliegen zu klären.";

const UEBERNOMMEN = Object.freeze({
  "hier ist am Satzende": "Ich möchte wissen, ob das Paket hier ist",
  "hier ist vor Kleinbuchstaben": "Ich möchte wissen, ob hier ist das Paket",
  "hi mitten im Satz": "Ich möchte wissen, ob hi im Paket steht",
  "hey mitten im Satz": "Ich möchte wissen, ob hey im Paket steht",
  "hello mitten im Satz": "Ich möchte wissen, ob hello im Paket steht",
  "Hallo mitten im Satz": "Ich möchte wissen, ob das Hallo-Paket angekommen ist",
});
const VERWORFEN = Object.freeze({
  "Gruß Hallo am Anfang": "Hallo, ich möchte einen Termin vereinbaren",
  "Gruß Guten Tag am Anfang": "Guten Tag, ich möchte einen Termin vereinbaren",
  "Hier ist mit Vor- und Nachname": "Ich möchte sagen: Hier ist Anna Müller",
  "Hier spricht mit Nachname": "Ich möchte sagen, hier spricht Müller",
  "Mein Name ist": "Ich möchte sagen, mein Name ist Anna",
  "my name is": "I want to say my name is Anna",
  "je m'appelle": "Je voudrais dire je m'appelle Anna",
  "Gruß nach Satzende": "Ich rufe an. Hallo zusammen",
  "Gruß nach Ausrufezeichen": "Ich rufe an! Hallo zusammen",
  "Gruß nach Doppelpunkt": "Ich möchte sagen: Hallo Anna",
});

async function zeileFuer(goal) {
  const srv = await startServer({
    env: {
      ...vorspannMandantenUmgebung([BOOTSTRAP_TENANT_ID]),
      ELEVENLABS_OPENING_LINE_LLM_ENABLED: "false",
    },
    seed: seedState({}),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: goal, language: "de" }),
    });
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    const { dynamic_variables: variablen } = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
    return variablen.opening_line;
  } finally {
    await srv.stop();
  }
}

test("Vorspann übernimmt das Anliegen, wenn Gruß oder hier ist nicht Vorstellung sind", async () => {
  for (const [name, goal] of Object.entries(UEBERNOMMEN)) {
    const zeile = await zeileFuer(goal);
    assert.ok(zeile.toLowerCase().includes(`${goal.toLowerCase()}.`), `${name}: ${zeile}`);
    assert.ok(!zeile.includes(FALLBACK_DE), `${name}: ${zeile}`);
  }
});

test("Vorspann verwirft eigenen Gruß und eigene Vorstellung im Anliegen weiter", async () => {
  for (const [name, goal] of Object.entries(VERWORFEN)) {
    const zeile = await zeileFuer(goal);
    assert.ok(!zeile.includes(goal), `${name}: ${zeile}`);
  }
});
