import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { waitUntil } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const HTTP_FEHLER = 500;
const HERMES_HOST = "instanz-schliessen.agent.test";
const CALL_ID = "x";
const TELNYX_ID = "tx-1";

function starteGegenstelle(status = HTTP_OK) {
  const pfade = [];
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      pfade.push(req.url);
      res.writeHead(status, { "content-type": "application/json" });
      res.end("{}");
    });
  }).then((server) => ({ ...server, pfade }));
}

function angehaltenerLauf() {
  let freigeben;
  const frei = new Promise((aufloesen) => (freigeben = aufloesen));
  const aufrufe = [];
  return {
    aufrufe,
    freigeben,
    leseAnruf: async (callId) => {
      aufrufe.push(callId);
      await frei;
      return { streamToken: "tok-1", from: "+4915112340001" };
    },
  };
}

async function postStatus(url, koerper) {
  const antwort = await abrufMitFrist(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(koerper),
  });
  await antwort.text();
  return antwort.status;
}

const waehle = (anbieter, befehl) =>
  postStatus(`${anbieter.url}/v2/calls`, {
    command_id: befehl,
    webhook_url: `https://${HERMES_HOST}/voice/vorspann?callId=${CALL_ID}`,
  });

async function starteAnnahmeKette(t, gegenstelle) {
  const anbieter = await starteAnrufstartAttrappe();
  const lauf = angehaltenerLauf();
  t.after(async () => {
    lauf.freigeben();
    await anbieter.schliessen();
  });
  anbieter.verbinde({ host: HERMES_HOST, url: gegenstelle.url, agentId: "agent_x", leseAnruf: lauf.leseAnruf });
  assert.equal(await waehle(anbieter, `vorspann-${CALL_ID}`), HTTP_OK);
  assert.equal(await waehle(anbieter, `vorspann-${CALL_ID}-el`), HTTP_OK);
  await waitUntil(() => lauf.aufrufe.length === 1);
  return { anbieter, lauf };
}

test("Attrappe: schliessen kehrt erst zurueck, wenn die Annahme-Kette ihre letzten Ereignisse gesendet hat", async (t) => {
  const gegenstelle = await starteGegenstelle();
  t.after(() => gegenstelle.close());
  const { anbieter, lauf } = await starteAnnahmeKette(t, gegenstelle);
  const geschlossen = anbieter.schliessen();
  lauf.freigeben();
  await geschlossen;
  assert.deepEqual(lauf.aufrufe, [CALL_ID]);
  assert.equal(gegenstelle.pfade.length, 4);
  assert.equal(gegenstelle.pfade.at(-1), `/voice/vorspann?callId=${CALL_ID}`);
});

test("Attrappe: schliessen kehrt erst zurueck, wenn das Auflege-Ereignis gesendet ist", async (t) => {
  const gegenstelle = await starteGegenstelle();
  t.after(() => gegenstelle.close());
  const { anbieter, lauf } = await starteAnnahmeKette(t, gegenstelle);
  lauf.freigeben();
  await waitUntil(() => gegenstelle.pfade.length === 4);
  const vorher = gegenstelle.pfade.length;
  assert.equal(await postStatus(`${anbieter.url}/v2/calls/cc_callee_${CALL_ID}/actions/hangup`, {}), HTTP_OK);
  await anbieter.schliessen();
  assert.equal(gegenstelle.pfade.length, vorher + 1);
});

test("Attrappe: Fehler der Annahme-Kette werden gemeldet und schliessen wirft nicht", async (t) => {
  const meldungen = [];
  t.mock.method(console, "error", (...teile) => meldungen.push(teile.join(" ")));
  const gegenstelle = await starteGegenstelle(HTTP_FEHLER);
  t.after(() => gegenstelle.close());
  const anbieter = await starteAnrufstartAttrappe();
  t.after(() => anbieter.schliessen());
  anbieter.verbinde({ host: HERMES_HOST, url: gegenstelle.url, agentId: "agent_x", leseAnruf: async () => null });
  assert.equal(await waehle(anbieter, `vorspann-${TELNYX_ID}`), HTTP_OK);
  await waitUntil(() => gegenstelle.pfade.length === 1);
  await anbieter.schliessen();
  assert.equal(meldungen.length, 1);
  assert.match(meldungen[0], /^\[attrappe\] ereignis: /);
});
