import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { CONV_ID, isoVor, starteAnbieterAttrappe } from "../_iel-inbound-harness.js";

const FRIST_MS = 15000;
const POLL_TAKT_MS = 100;
const MAX_DAUER_S = 3600;
const FRISCH_S = 5;
const GESPRAECH_S = 30;
const ID = "call_4396_live";
const VORSPANN = "Hallo, hier ist Hermes";
const ZEILEN = [
  { role: "agent", message: "Guten Tag, hier spricht ein KI-Assistent." },
  { role: "user", message: "Ja, bitte?" },
  { role: "agent", message: "Ich möchte einen Termin [laut] vereinbaren." },
  { role: "user", message: null },
  { role: "user", message: "Donnerstag passt." },
];
const SPRECHBAR = [
  "Guten Tag, hier spricht ein KI-Assistent.",
  "Ja, bitte?",
  "Ich möchte einen Termin vereinbaren.",
  "Donnerstag passt.",
];

const gespraech = (status, zeilen) => ({
  conversation_id: CONV_ID,
  status,
  transcript: zeilen,
  analysis: status === "done" ? { call_successful: "success", transcript_summary: "Termin vereinbart." } : null,
  metadata: { call_duration_secs: GESPRAECH_S, phone_call: { direction: "outbound", call_id: "sip_4396" } },
});

const texte = (srv) => srv.readStore().calls.find((call) => call.id === ID).transcript.map((zeile) => zeile.text);
const warteAufZeilen = (srv, anzahl) =>
  waitForStoreState(srv, (stand) => stand.calls.find((call) => call.id === ID).transcript.length >= anzahl, FRIST_MS);

async function mitLaufendemAnruf(lauf) {
  const el = await starteAnbieterAttrappe();
  const answeredAt = isoVor(FRISCH_S);
  const call = seedCall({
    id: ID,
    provider: "telnyx",
    twilioSid: `v3:${ID}`,
    maxDurationS: MAX_DAUER_S,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    diagnostic: true,
    answeredAt,
    startedAt: answeredAt,
    elevenlabsConversationId: CONV_ID,
    elBoundAt: answeredAt,
    transcript: [{ role: "agent", text: VORSPANN, at: answeredAt }],
  });
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: el.url, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS), DIAGNOSTIC_RETENTION_DAYS: "7" },
    seed: seedState({ settings: { allowSummaries: false }, calls: [call] }),
  });
  try {
    await lauf({ srv, el });
  } finally {
    await srv.stop();
    await el.close();
  }
}

test("4396: laufender Anruf zeigt die Zeilen des Anbieters, neue Zeilen kommen dazu, nichts doppelt, Ende ohne Duplikate", async () => {
  await mitLaufendemAnruf(async ({ srv, el }) => {
    el.setzeAntwort(gespraech("in-progress", ZEILEN.slice(0, 2)));
    await warteAufZeilen(srv, 3);
    assert.equal(srv.readStore().calls.find((call) => call.id === ID).status, "active");
    assert.deepEqual(texte(srv), [VORSPANN, SPRECHBAR[0], SPRECHBAR[1]]);

    const abrufe = el.gets().length;
    await waitForStoreState(srv, () => el.gets().length >= abrufe + 2, FRIST_MS);
    assert.deepEqual(texte(srv), [VORSPANN, SPRECHBAR[0], SPRECHBAR[1]], "kein Duplikat bei unverändertem Stand");

    el.setzeAntwort(gespraech("in-progress", ZEILEN.slice(0, 3)));
    await warteAufZeilen(srv, 4);
    assert.deepEqual(texte(srv), [VORSPANN, ...SPRECHBAR.slice(0, 3)]);

    el.setzeAntwort(gespraech("done", ZEILEN));
    await waitForStoreState(srv, (stand) => Boolean(stand.calls.find((call) => call.id === ID).billedAt), FRIST_MS);
    assert.deepEqual(texte(srv), [VORSPANN, ...SPRECHBAR]);
  });
});

test("4396: ein Abruf ohne Gespräch schreibt nichts und stoppt den Takt nicht; gleicher Text anderer Rolle ist eine neue Zeile", async () => {
  await mitLaufendemAnruf(async ({ srv, el }) => {
    el.setzeAntwort(null);
    const abrufe = el.gets().length;
    await waitForStoreState(srv, () => el.gets().length >= abrufe + 2, FRIST_MS);
    assert.deepEqual(texte(srv), [VORSPANN]);

    el.setzeAntwort(gespraech("in-progress", [{ role: "user", message: VORSPANN }]));
    await warteAufZeilen(srv, 2);
    assert.deepEqual(texte(srv), [VORSPANN, VORSPANN]);
    assert.deepEqual(
      srv.readStore().calls.find((call) => call.id === ID).transcript.map((zeile) => zeile.role),
      ["agent", "caller"],
    );
  });
});
