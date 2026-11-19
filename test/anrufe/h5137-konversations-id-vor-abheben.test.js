import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";

import { config } from "../../src/config.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import {
  ELEVENLABS_INIT_PATH,
  INIT_TOKEN_HEADER,
  makeElevenLabsInitWebhookRoutes,
} from "../../src/routes/webhooks-elevenlabs-init.ts";
import { H7C2B4B2_BINDUNGS_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { EL_INBOUND_ACCESS_BOOT_ENV } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const HTTP_OK = 200;
const SPEICHERN_DAUERT_DURCHLAEUFE = 200;
const AGENT_ID = "agent_h5137";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const KONVERSATION = "conv_h5137_neu";
const ABSENDER = "+4930555000337";
const ZIEL = "+4915112349937";

config.voice.elevenLabsInbound.initWebhookToken = INIT_TOKEN;
config.voice.elevenLabsOutbound.agentId = AGENT_ID;

async function ereignisschleifeDrehen(durchlaeufe) {
  for (let i = 0; i < durchlaeufe; i += 1) await new Promise((weiter) => setImmediate(weiter));
}

function langsamesSpeichern(runner) {
  const zustand = { langsam: false };
  const langsam = {
    withClient: async (arbeit) => {
      if (zustand.langsam) await ereignisschleifeDrehen(SPEICHERN_DAUERT_DURCHLAEUFE);
      return runner.withClient(arbeit);
    },
  };
  return { zustand, langsam };
}

async function konversationInDatenbank(runner, callId) {
  return runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    const { rows } = await client.query("SELECT elevenlabs_conversation_id FROM call WHERE id = $1", [callId]);
    return rows[0].elevenlabs_conversation_id;
  });
}

const initRuf = (url, token = H7C2B4B2_BINDUNGS_TOKEN) =>
  abrufMitFrist(`${url}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: KONVERSATION,
      called_number: ABSENDER,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token },
    }),
  });

async function mitInitServer(store, lauf, speicherFristMs = undefined) {
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsInitWebhookRoutes({
      store,
      config,
      speicherFristMs,
      bridges: { clearDeadlines: () => {} },
      outboundInitInhalt: () => ({ marke: "h5137" }),
      vorspannText: () => "",
    }),
  );
  const server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  try {
    return await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

test("H5137-1: der EL-Init antwortet erst, wenn die Konversations-ID des wartenden Anrufs in der Datenbankzeile steht, auch wenn das Speichern dauert", async () => {
  const { runner } = await makePgTestStore();
  const { zustand, langsam } = langsamesSpeichern(runner);
  const a = makePgStore(langsam);
  await a.init();
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  Object.assign(call, {
    elevenlabsConversationId: null,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: new Date().toISOString(),
    streamToken: H7C2B4B2_BINDUNGS_TOKEN,
  });
  await a.persistCall(call.id);
  zustand.langsam = true;
  await mitInitServer(a, async (url) => {
    const antwort = await initRuf(url);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(await konversationInDatenbank(runner, call.id), KONVERSATION);
  });
});

test("H5137-2: schlaegt das Speichern fehl, antwortet der EL-Init trotzdem mit 200 und meldet den Fehler im Protokoll", async (t) => {
  const protokoll = [];
  t.mock.method(console, "error", (...teile) => protokoll.push(teile.join(" ")));
  const { store } = await makePgTestStore();
  const call = store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  Object.assign(call, {
    elevenlabsConversationId: null,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: new Date().toISOString(),
    streamToken: H7C2B4B2_BINDUNGS_TOKEN,
  });
  await store.persistCall(call.id);
  const kaputt = mitSpeichern(store, () => Promise.reject(new Error("Datenbank weg")));
  await mitInitServer(kaputt, async (url) => {
    assert.equal((await initRuf(url)).status, HTTP_OK);
  });
  assert.deepEqual(protokoll, ["[el-init] speichern fehlgeschlagen: Datenbank weg"]);
});

function mitSpeichern(store, speichern) {
  return Object.assign(Object.create(store), {
    bindInboundElConversation: (id, bindung) => {
      const ergebnis = store.bindInboundElConversation(id, bindung);
      return ergebnis.changed ? { ...ergebnis, dauerhaft: speichern(ergebnis) } : ergebnis;
    },
  });
}

function wartendesAnruf(store) {
  const call = store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  Object.assign(call, {
    elevenlabsConversationId: null,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: new Date().toISOString(),
    streamToken: H7C2B4B2_BINDUNGS_TOKEN,
  });
  return call;
}

test("H5137-3: haengt fremde, langsame Arbeit in der Speicherkette, antwortet der EL-Init trotzdem mit der gebundenen ID in der Datenbankzeile", async () => {
  const { runner } = await makePgTestStore();
  const sperre = { offen: null };
  const gesperrt = {
    withClient: async (arbeit) => {
      const halten = sperre.offen;
      sperre.offen = null;
      if (halten) await halten.promise;
      return runner.withClient(arbeit);
    },
  };
  const a = makePgStore(gesperrt);
  await a.init();
  const call = wartendesAnruf(a);
  await a.persistCall(call.id);
  const fremd = wartendesAnruf(a);
  await a.drainFlushes();
  const halten = Promise.withResolvers();
  sperre.offen = halten;
  const fremdSpeichern = a.persistCall(fremd.id);
  try {
    await mitInitServer(a, async (url) => {
      const antwort = await initRuf(url);
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(await konversationInDatenbank(runner, call.id), KONVERSATION);
    });
  } finally {
    halten.resolve();
    await fremdSpeichern;
  }
});

test("H5137-4: speichert die Datenbank nicht innerhalb der Frist, antwortet der EL-Init mit 200 und meldet die Frist im Protokoll", async (t) => {
  const protokoll = [];
  t.mock.method(console, "error", (...teile) => protokoll.push(teile.join(" ")));
  const { store } = await makePgTestStore();
  const call = wartendesAnruf(store);
  await store.persistCall(call.id);
  const haengt = mitSpeichern(store, () => new Promise(() => {}));
  const FRIST_MS = 25;
  await mitInitServer(haengt, async (url) => {
    assert.equal((await initRuf(url)).status, HTTP_OK);
  }, FRIST_MS);
  assert.deepEqual(protokoll, ["[el-init] speichern fehlgeschlagen: Frist von 25 ms abgelaufen"]);
});

test("H5137-5: eine wiederholte Bindung ohne Aenderung wartet nicht aufs Speichern", async (t) => {
  const protokoll = [];
  t.mock.method(console, "error", (...teile) => protokoll.push(teile.join(" ")));
  const { store } = await makePgTestStore();
  const call = wartendesAnruf(store);
  await store.persistCall(call.id);
  let gespeichert = 0;
  const zaehlend = mitSpeichern(store, () => {
    gespeichert += 1;
    return Promise.resolve();
  });
  await mitInitServer(zaehlend, async (url) => {
    assert.equal((await initRuf(url)).status, HTTP_OK);
    assert.equal((await initRuf(url)).status, HTTP_OK);
  });
  assert.equal(gespeichert, 1);
  assert.deepEqual(protokoll, []);
});

test("H5137-6: das gezielte Speichern schreibt die ID nur in die Zeile eines laufenden Anrufs", async () => {
  const { store, runner } = await makePgTestStore();
  const beendet = wartendesAnruf(store);
  await store.persistCall(beendet.id);
  await runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    await client.query("UPDATE call SET status = 'completed' WHERE id = $1", [beendet.id]);
  });
  const jetzt = new Date().toISOString();
  const beendetBindung = store.bindInboundElConversation(beendet.id, { conversationId: KONVERSATION, nowIso: jetzt });
  await beendetBindung.dauerhaft;
  assert.equal(await konversationInDatenbank(runner, beendet.id), null);
  const laufend = wartendesAnruf(store);
  await store.persistCall(laufend.id);
  const laufendBindung = store.bindInboundElConversation(laufend.id, { conversationId: KONVERSATION, nowIso: jetzt });
  await laufendBindung.dauerhaft;
  assert.equal(await konversationInDatenbank(runner, laufend.id), KONVERSATION);
});
