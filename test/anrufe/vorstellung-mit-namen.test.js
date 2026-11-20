import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { seedState, startServer, TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { beinLegtAuf, initInhaltFuer, starteSchaltbarenAnbieter } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const EINMAL = 1;
const TTS_PFAD = "/v1/text-to-speech/";

const AUDIO_BYTES = 200_000;
const KENNUNG = "begruessung";

function anbieterVerhalten(sprechtexte) {
  return (anfrage, antwort) => {
    let roh = "";
    anfrage.on("data", (teil) => (roh += teil));
    anfrage.on("end", () => {
      if (anfrage.url.startsWith(TTS_PFAD)) {
        sprechtexte.push(JSON.parse(roh).text);
        antwort.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return antwort.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      const befehl = anfrage.url === "/v2/calls" ? JSON.parse(roh).command_id : "";
      const kennung = befehl.replace(/^vorspann-/, "").replace(/-el$/, "");
      antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
      antwort.end(JSON.stringify({ data: { call_control_id: `${befehl.endsWith("-el") ? "cc_el_" : "cc_callee_"}${kennung}`, result: "ok" } }));
    });
  };
}

async function mitServer(lauf) {
  const sprechtexte = [];
  const attrappe = await starteSchaltbarenAnbieter(anbieterVerhalten(sprechtexte), KENNUNG, [BOOTSTRAP_TENANT_ID]);
  const srv = await startServer({ env: { ...attrappe.env, ELEVENLABS_RESULT_POLL_MS: "60000" }, seed: seedState({}), ownerNumber: TELNYX_TEST_OWNER_NUMBER });
  try {
    return await lauf(async (objective, language) => {
      sprechtexte.length = 0;
      const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective, language }),
      });
      const text = await antwort.text();
      assert.equal(antwort.status, HTTP_OK, text);
      const callId = JSON.parse(text).callId;
      const init = await initInhaltFuer(srv, { callId, agentId: `agent_${KENNUNG}` });
      assert.equal(sprechtexte.length, EINMAL);
      const gesprochen = sprechtexte[0];
      await beinLegtAuf(srv, callId);
      return { gesprochen, init };
    });
  } finally {
    await srv.stop();
    await attrappe.close();
  }
}

const MIT_NAMEN = [
  ["de", "Ich bin Anna Muster und möchte einen Termin verschieben", "Ich rufe an, um ein kurzes Anliegen zu klären."],
  ["en", "This is Anna, I would like to move an appointment", "I am calling to sort out a small matter with you."],
  ["fr", "C'est Anna, je voudrais déplacer un rendez-vous", "J'appelle pour régler une petite demande."],
  ["fr", "Ici Anna, je voudrais déplacer un rendez-vous", "J'appelle pour régler une petite demande."],
  ["en", "I am Anna Muster and I would like to move an appointment.", "I am calling to sort out a small matter with you."],
  ["en", "I'm Anna Muster and I would like to move an appointment.", "I am calling to sort out a small matter with you."],
  ["fr", "Je suis Anna Muster et je voudrais déplacer un rendez-vous.", "J'appelle pour régler une petite demande."],
];

const OHNE_NAMEN = [
  ["de", "Ich rufe an, um einen Termin zu verschieben."],
  ["en", "I am calling to move an appointment."],
  ["fr", "J'appelle pour déplacer un rendez-vous."],
  ["en", "This shirt needs to be exchanged."],
  ["fr", "Voici Lundi comme date pour déplacer un rendez-vous."],
];

test("vorstellung-mit-namen: Ziel mit Selbstvorstellung samt Namen wird nicht gesprochen, der feste Anlass ersetzt es", async () => {
  await mitServer(async (ruf) => {
    for (const [sprache, ziel, fallback] of MIT_NAMEN) {
      const { gesprochen } = await ruf(ziel, sprache);
      assert.ok(gesprochen.toLowerCase().includes(fallback.replace(/\.$/, "").toLowerCase()), `${ziel} -> ${gesprochen}`);
      assert.ok(!gesprochen.includes("Anna"), `${ziel} -> ${gesprochen}`);
      const hermes = gesprochen.split("Hermes").length - 1;
      if (sprache === "de") assert.equal(hermes, EINMAL, `${ziel} -> ${gesprochen}`);
      else assert.ok(hermes <= EINMAL, `${ziel} -> ${gesprochen}`);
    }
  });
});

test("vorstellung-mit-namen: Ziel in Ich-Form ohne Namen bleibt der gesprochene Anlass", async () => {
  await mitServer(async (ruf) => {
    for (const [sprache, ziel] of OHNE_NAMEN) {
      const { gesprochen } = await ruf(ziel, sprache);
      assert.ok(gesprochen.toLowerCase().includes(ziel.replace(/\.$/, "").toLowerCase()), `${ziel} -> ${gesprochen}`);
    }
  });
});
