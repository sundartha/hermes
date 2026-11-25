import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { seedState, startServer, TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { beinLegtAuf, initInhaltFuer, starteSchaltbarenAnbieter } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const EINMAL = 1;
const TTS_PFAD = "/v1/text-to-speech/";
const GRUESSE = /\b(hallo|guten tag|guten morgen|hello|hi|bonjour|salut)\b/gi;
const VORSTELLUNGEN = /\b(ich bin|hier ist|hier spricht|mein name ist|i am|this is|my name is|je suis|ici)\b/gi;
const FALLBACK_DE = "Ich rufe an, um ein kurzes Anliegen zu klären.";

const AUDIO_BYTES = 200_000;
const KENNUNG = "begruessung";
const treffer = (text, muster) => text.match(muster) ?? [];

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
    return await lauf(async (objective) => {
      sprechtexte.length = 0;
      const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective, language: "de" }),
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

function pruefeEinmal({ gesprochen, init }) {
  assert.equal(treffer(gesprochen, GRUESSE).length, EINMAL, gesprochen);
  assert.equal(treffer(gesprochen, VORSTELLUNGEN).length, EINMAL, gesprochen);
  assert.equal(treffer(gesprochen, /Hermes/g).length, EINMAL, gesprochen);
  const anschluss = init.conversation_config_override.agent.first_message;
  assert.ok(anschluss.endsWith(" Bitte sprechen Sie."), anschluss);
  assert.equal(treffer(anschluss, GRUESSE).length, 0, anschluss);
  assert.equal(treffer(anschluss, VORSTELLUNGEN).length, 0, anschluss);
  assert.equal(init.dynamic_variables.eroeffnung_gesagt, gesprochen);
}

const BRAUCHBAR = [
  "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.",
  "Termin zur Bremsenprüfung vereinbaren",
  "Ich brauche Hilfe bei der Rechnung vom Hirten.",
  "Ich möchte das Shirt umtauschen.",
  "Ich möchte wissen, wann die Lieferung ankommt, die ich gestern bestellt habe.",
];

const MIT_EIGENEM_GRUSS = [
  "Hallo, ich möchte einen Termin verschieben.",
  "Hi, ich möchte einen Termin verschieben.",
  "Hey, ich möchte einen Termin verschieben.",
  "Guten Tag, ich möchte einen Termin verschieben.",
  "Guten Morgen, ich möchte einen Termin verschieben.",
  "Guten Abend, ich möchte einen Termin verschieben.",
  "Ich möchte einen Termin verschieben, hier ist Anna Muster.",
  "Ich möchte einen Termin verschieben, hier spricht Anna Muster.",
  "Mein Name ist Anna Muster und ich möchte einen Termin verschieben.",
  "Hello, I would like to move an appointment.",
  "Good morning, I would like to move an appointment.",
  "Good afternoon, I would like to move an appointment.",
  "Good evening, I would like to move an appointment.",
  "My name is Anna Muster and I would like to move an appointment.",
  "Bonjour, je voudrais déplacer un rendez-vous.",
  "Bonsoir, je voudrais déplacer un rendez-vous.",
  "Salut, je voudrais déplacer un rendez-vous.",
  "Je m'appelle Anna Muster et je voudrais déplacer un rendez-vous.",
];

test("begruessung-einmal: brauchbarer Anlass wird übernommen, Vorspann grüßt und stellt sich genau einmal vor", async () => {
  await mitServer(async (ruf) => {
    for (const ziel of BRAUCHBAR) {
      const ergebnis = await ruf(ziel);
      pruefeEinmal(ergebnis);
      const anlass = ziel.replace(/\.$/, "");
      assert.ok(ergebnis.gesprochen.toLowerCase().includes(anlass.toLowerCase()), `${ziel} -> ${ergebnis.gesprochen}`);
    }
  });
});

test("begruessung-einmal: Ziel mit eigenem Gruß oder eigener Vorstellung wird nicht gesprochen, der feste Anlass ersetzt es", async () => {
  await mitServer(async (ruf) => {
    for (const ziel of MIT_EIGENEM_GRUSS) {
      const ergebnis = await ruf(ziel);
      pruefeEinmal(ergebnis);
      assert.ok(ergebnis.gesprochen.toLowerCase().includes(FALLBACK_DE.replace(/\.$/, "").toLowerCase()), `${ziel} -> ${ergebnis.gesprochen}`);
    }
  });
});
