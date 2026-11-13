import assert from "node:assert/strict";
import test from "node:test";

import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, seedState, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const OWNER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_4065b",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_4065b",
  ELEVENLABS_API_KEY: "el-4065-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  OWNER_SELF_CALL_ENABLED: "true",
});

const DRITTER = "+491713920099";
const ANREDE = "Address them directly";
const NACHFRAGE_VERBOT = /never ask whether they are still there or can hear you/i;
const WARTE_ANWEISUNG = /until the other person has answered|keep waiting/i;

const FAELLE = [
  { sprache: "de", nummer: "+491713920012", auftrag: "Termin vereinbaren" },
  { sprache: "en", nummer: "+447700900123", auftrag: "arrange an appointment" },
  { sprache: "fr", nummer: "+33612345678", auftrag: "prendre rendez-vous" },
];

async function ausgehenderAnruf({ sprache, nummer, auftrag, ziel = nummer }) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url, OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    seed: seedState({
      settings: { language: sprache },
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER, firstName: OWNER_TEST_FIRST_NAME, privateNumber: nummer },
      ],
    }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ziel, objective: auftrag }),
    });
    assert.equal(res.status, HTTP_OK, await res.text());
    const [start] = anbieter.starts();
    return start.body.conversation_initiation_client_data;
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

for (const fall of FAELLE) {
  test(`4065-2: nach der Eroeffnung an den Besitzer wartet der Agent auf die Antwort und fragt nicht nach (${fall.sprache})`, async () => {
    const daten = await ausgehenderAnruf(fall);
    const beziehung = daten.dynamic_variables.callee_relation;
    const anrede = beziehung.indexOf(ANREDE);
    const verbot = beziehung.search(NACHFRAGE_VERBOT);
    const warten = beziehung.search(WARTE_ANWEISUNG);
    assert.ok(anrede >= 0, beziehung);
    assert.ok(verbot > anrede, beziehung);
    assert.ok(warten > anrede, beziehung);
  });
}

test("4065-2: Anruf an eine fremde Nummer traegt keine Warte-Anweisung, die Offenlegung bleibt unberuehrt", async () => {
  const daten = await ausgehenderAnruf({ ...FAELLE[0], ziel: DRITTER });
  assert.equal(daten.dynamic_variables.callee_relation, "");
  assert.doesNotMatch(JSON.stringify(daten), WARTE_ANWEISUNG);
});
