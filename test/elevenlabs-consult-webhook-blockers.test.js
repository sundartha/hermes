import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { MAX_OPEN_POLLS_PER_CALL } from "../src/consult/delivery.js";
import { CONFIRMATION_SECRET_MIN_LENGTH } from "../src/call-confirmation.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { neuePglite } from "./pglite-helfer.js";

const HTTP_NOT_FOUND = 404;

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

const OUTBOUND_CALL_ID = "call_el_outbound";
const OUTBOUND_CONVERSATION_ID = "conv_el_outbound_1";
const INBOUND_CALL_ID = "call_el_inbound";
const INBOUND_CONVERSATION_ID = "conv_el_inbound_1";

const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";

const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
});

const SHORT_CONSULT_ENV = Object.freeze({
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: "1500",
  EL_CONSULT_DELIVERY_MS: "400",
  EL_CONSULT_ACK_MS: "400",
  EL_CONSULT_ANSWER_MS: "1500",
});

const WEBHOOK_ENV = Object.freeze({
  ...CONSULT_ON_ENV,
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  ...SHORT_CONSULT_ENV,
});

const MAX_DURATION_S = 300;
const ANSWERED_AGO_MS = 5000;
const PARALLELE_AUFRUFE = 8;

const post = (srv, body, headers = {}) =>
  abrufMitFrist(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const withToken = (srv, conversationId) =>
  post(
    srv,
    { conversation_id: conversationId, question: QUESTION },
    { [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
  );

const callOf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);
const consultCount = (call) => (Array.isArray(call.consults) ? call.consults.length : 0);

const laufenderAnruf = (overrides) =>
  seedCall({
    status: "active",
    maxDurationS: MAX_DURATION_S,
    answeredAt: new Date(Date.now() - ANSWERED_AGO_MS).toISOString(),
    ...overrides,
  });

const outboundSeed = () =>
  seedState({
    calls: [
      laufenderAnruf({
        id: OUTBOUND_CALL_ID,
        direction: "outbound",
        elevenlabsConversationId: OUTBOUND_CONVERSATION_ID,
      }),
    ],
  });

let makePgStore, jsonStore, maxConsultsPerCall, dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-el-consult-"));
  process.env.DATA_DIR = dataDir;
  ({ makePgStore } = await import("../src/store/pg.js"));
  jsonStore = await import("../src/store/json.js");
  ({ MAX_IN_CALL_CONSULTS_PER_CALL: maxConsultsPerCall } = await import(
    "../src/consult/in-call.js"
  ));
});

async function makePgTestStore() {
  const db = await neuePglite();
  const runner = {
    withClient: (fn) => fn({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const newCall = (over = {}) => ({
  direction: "outbound",
  from: "+49",
  to: "+49",
  tenantId: BOOTSTRAP_TENANT_ID,
  ...over,
});

test("EL-CONSULT BL-1a: die ElevenLabs-Kennung wird ueber den regulaeren Schreibweg hinterlegt und ist danach im json-Store auffindbar", () => {
  const created = jsonStore.createCall(newCall());
  assert.equal(
    created.elevenlabsConversationId,
    null,
    "Call-Default: null, nie undefined (json<->pg-Parity, Muster telnyxConversationId)",
  );

  jsonStore.recordElevenlabsConversationId(created.id, "conv_el_erste");
  jsonStore.recordElevenlabsConversationId(created.id, "conv_el_zweite");
  assert.equal(
    jsonStore.getCall(created.id).elevenlabsConversationId,
    "conv_el_erste",
    "zweiter Aufruf mit anderer Kennung aendert nichts (set-once, Muster recordTelnyxConversationId)",
  );

  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const gefunden = onDisk.calls.find((call) => call.elevenlabsConversationId === "conv_el_erste");
  assert.equal(gefunden?.id, created.id, "Kennung ueberlebt JSON.stringify/parse und bindet den Anruf");
});

test("EL-CONSULT BL-1b: die ElevenLabs-Kennung ueberlebt Schreiben und Wiederlesen im pg-Store (Spalte + Flush + rowToCall)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  assert.equal(created.elevenlabsConversationId, null, "pg-Call-Default: null, nie undefined");

  store.recordElevenlabsConversationId(created.id, "conv_el_pg");
  await store.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(
    reopened.getCall(created.id).elevenlabsConversationId,
    "conv_el_pg",
    "Kennung ueberlebt den Reopen - ohne Spalte + ON CONFLICT DO UPDATE SET + rowToCall ginge sie beim Restart verloren UND der naechste Flush schriebe NULL zurueck",
  );
});

test("EL-CONSULT BL-2: ist der Deckel fuer Rueckfragen je Anruf erreicht, lehnt der Webhook ab, statt eine weitere anzulegen", async (ctx) => {
  const srv = await startServer({ env: WEBHOOK_ENV, seed: outboundSeed() });
  try {
    await ctx.test("das Kontingent laesst sich regulaer aufbrauchen", async () => {
      for (let i = 0; i < maxConsultsPerCall; i++) {
        const res = await withToken(srv, OUTBOUND_CONVERSATION_ID);
        assert.ok(res.ok, `Rueckfrage ${i + 1} muss angenommen werden, war ${res.status}`);
      }
      assert.equal(consultCount(callOf(srv, OUTBOUND_CALL_ID)), maxConsultsPerCall);
    });

    await ctx.test("die Rueckfrage ueber dem Deckel wird abgelehnt", async () => {
      const res = await withToken(srv, OUTBOUND_CONVERSATION_ID);
      assert.equal(
        res.status,
        HTTP_NOT_FOUND,
        "MAX_IN_CALL_CONSULTS_PER_CALL ist erreicht - der Kanal ist fuer diesen Anruf zu",
      );
    });

    await ctx.test("es ist KEIN zusaetzlicher Consult entstanden", () => {
      assert.equal(
        consultCount(callOf(srv, OUTBOUND_CALL_ID)),
        maxConsultsPerCall,
        "jede weitere Rueckfrage haelt das kostende Gespraech bis CONSULT_OPEN_MS offen",
      );
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT BL-3: ein INBOUND-Anruf wird abgelehnt, auch bei gueltigem Token und laufendem Gespraech", async (ctx) => {
  const srv = await startServer({
    env: WEBHOOK_ENV,
    seed: seedState({
      calls: [
        laufenderAnruf({
          id: INBOUND_CALL_ID,
          direction: "inbound",
          elevenlabsConversationId: INBOUND_CONVERSATION_ID,
        }),
        laufenderAnruf({
          id: OUTBOUND_CALL_ID,
          direction: "outbound",
          elevenlabsConversationId: OUTBOUND_CONVERSATION_ID,
        }),
      ],
    }),
  });
  try {
    await ctx.test("Inbound -> abgelehnt, fremde Rede erreicht den Tenant-Kontext nicht", async () => {
      const res = await withToken(srv, INBOUND_CONVERSATION_ID);
      assert.equal(
        res.status,
        HTTP_NOT_FOUND,
        "call.direction === 'outbound' ist der Sicherheitskern (consult/in-call.js)",
      );
      assert.equal(consultCount(callOf(srv, INBOUND_CALL_ID)), 0, "kein Consult am Inbound-Anruf");
    });

    await ctx.test("Gegenprobe: derselbe Server nimmt den gleichwertigen OUTBOUND-Anruf an", async () => {
      const res = await withToken(srv, OUTBOUND_CONVERSATION_ID);
      assert.ok(res.ok, `2xx erwartet, war ${res.status} - dann misst die Ablehnung oben nichts`);
      assert.equal(consultCount(callOf(srv, OUTBOUND_CALL_ID)), 1);
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT BL-4: mehr gleichzeitige Rueckfragen am selben Anruf als erlaubt -> die ueberzaehligen werden abgelehnt statt gehalten", async (ctx) => {
  const srv = await startServer({ env: WEBHOOK_ENV, seed: outboundSeed() });
  try {
    const antworten = await Promise.all(
      Array.from({ length: PARALLELE_AUFRUFE }, () => withToken(srv, OUTBOUND_CONVERSATION_ID)),
    );
    const angenommen = antworten.filter((res) => res.ok).length;

    await ctx.test("hoechstens MAX_OPEN_POLLS_PER_CALL Aufrufe werden gehalten", () => {
      assert.ok(
        angenommen <= MAX_OPEN_POLLS_PER_CALL,
        `hoechstens ${MAX_OPEN_POLLS_PER_CALL} angenommen erwartet, waren ${angenommen} von ${PARALLELE_AUFRUFE}`,
      );
    });

    await ctx.test("Positiv-Kontrolle: mindestens ein Aufruf wird angenommen", () => {
      assert.ok(angenommen >= 1, "ein Endpunkt, der alles ablehnt, misst die Obergrenze nicht");
    });

    await ctx.test("kein Consult ueber der Obergrenze angelegt", () => {
      const angelegt = consultCount(callOf(srv, OUTBOUND_CALL_ID));
      assert.ok(
        angelegt <= MAX_OPEN_POLLS_PER_CALL,
        `hoechstens ${MAX_OPEN_POLLS_PER_CALL} Consults erwartet, waren ${angelegt}`,
      );
    });
  } finally {
    await srv.stop();
  }
});

const { elInboundInitSpawnEnv, initBindungsKoerper, spawnSeedWartenderElCall } = await import(
  "./_iel-inbound-harness.js"
);
const { OWNER_TEST_NUMBER } = await import("./helpers.js");

const SCHUTZ_HTTP_OK = 200;
const SCHUTZ_HTTP_BAD_REQUEST = 400;
const SCHUTZ_HTTP_PAYMENT_REQUIRED = 402;
const SCHUTZ_HTTP_FORBIDDEN = 403;
const SCHUTZ_HTTP_SERVER_ERROR = 500;
const SCHUTZ_HTTP_SERVICE_UNAVAILABLE = 503;

const LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const SCHUTZ_CALL_ID = "call_el_schutz";
const SCHUTZ_CONVERSATION_ID = "conv_el_schutz_1";
const DEFEKT_CALL_ID = "call_el_schutz_defekt";
const DEFEKT_CONVERSATION_ID = "conv_el_schutz_defekt_1";
const UNBEKANNTE_CONVERSATION_ID = "conv_el_schutz_unbekannt";
const FALSCHES_TOOL_TOKEN = "el-tool-token-falsch";
const LOOKUP_QUERY = "opening hours Grove Street Auto Repair Portland";
const GERISSENE_DECKE_EUR = 99;

const SCHUTZ_WEBHOOK_ENV = Object.freeze({
  ...CONSULT_ON_ENV,
  LOOKUP_ENABLED: "true",
  EXA_API_KEY: "exa-test-key",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  MULTI_TENANT: "true",
});

const schutzSeed = () =>
  seedState({
    calls: [
      laufenderAnruf({
        id: SCHUTZ_CALL_ID,
        direction: "outbound",
        elevenlabsConversationId: SCHUTZ_CONVERSATION_ID,
      }),
      laufenderAnruf({
        id: DEFEKT_CALL_ID,
        direction: "outbound",
        elevenlabsConversationId: DEFEKT_CONVERSATION_ID,
        consults: {},
        lookupLog: {},
      }),
    ],
  });

const webhookAntwort = async (srv, { pfad, token = TOOL_TOKEN, body }) => {
  const res = await abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const frage = (conversationId, question, token = TOOL_TOKEN) => ({
  pfad: CONSULT_PATH,
  token,
  body: { conversation_id: conversationId, question },
});

const recherche = (conversationId, query, token = TOOL_TOKEN) => ({
  pfad: LOOKUP_PATH,
  token,
  body: { conversation_id: conversationId, query },
});

test("[NIE1] Konsultations- und Recherche-Webhook antworten mit 403, 404, 400 und 500 samt bisherigem Text, nie mit 200", async () => {
  const srv = await startServer({ env: SCHUTZ_WEBHOOK_ENV, seed: schutzSeed() });
  try {
    const verweigert = { status: SCHUTZ_HTTP_FORBIDDEN, body: { error: "token" } };
    const ohneAnruf = { status: HTTP_NOT_FOUND, body: { error: "kein_laufender_anruf" } };
    const intern = { status: SCHUTZ_HTTP_SERVER_ERROR, body: { error: "intern" } };
    const faelle = [
      [frage(SCHUTZ_CONVERSATION_ID, QUESTION, FALSCHES_TOOL_TOKEN), verweigert],
      [recherche(SCHUTZ_CONVERSATION_ID, LOOKUP_QUERY, FALSCHES_TOOL_TOKEN), verweigert],
      [frage(UNBEKANNTE_CONVERSATION_ID, QUESTION), ohneAnruf],
      [recherche(UNBEKANNTE_CONVERSATION_ID, LOOKUP_QUERY), ohneAnruf],
      [
        frage(SCHUTZ_CONVERSATION_ID, "   "),
        { status: SCHUTZ_HTTP_BAD_REQUEST, body: { error: "keine_frage" } },
      ],
      [
        recherche(SCHUTZ_CONVERSATION_ID, undefined),
        { status: SCHUTZ_HTTP_BAD_REQUEST, body: { error: "keine_anfrage" } },
      ],
      [frage(DEFEKT_CONVERSATION_ID, QUESTION), intern],
      [recherche(DEFEKT_CONVERSATION_ID, LOOKUP_QUERY), intern],
    ];
    for (const [anfrage, erwartet] of faelle) {
      const antwort = await webhookAntwort(srv, anfrage);
      const fall = `${anfrage.pfad} mit ${JSON.stringify(anfrage.body)}`;
      assert.notEqual(antwort.status, SCHUTZ_HTTP_OK, `${fall} darf nie mit 200 antworten`);
      assert.deepEqual(antwort, erwartet, fall);
    }
    assert.equal(
      consultCount(callOf(srv, SCHUTZ_CALL_ID)),
      0,
      "keine abgelehnte Rueckfrage legt einen Consult an",
    );
  } finally {
    await srv.stop();
  }
});

test("[NIE1] Konsultations- und Recherche-Webhook antworten bei erschoepftem Guthaben mit 402 und budget_tenant", async () => {
  const seed = schutzSeed();
  seed.usage = {
    [BOOTSTRAP_TENANT_ID]: {
      inputTokens: 0,
      outputTokens: 0,
      costEur: GERISSENE_DECKE_EUR,
      calls: 1,
    },
  };
  const srv = await startServer({ env: SCHUTZ_WEBHOOK_ENV, seed });
  try {
    const consult = await webhookAntwort(srv, {
      pfad: CONSULT_PATH,
      body: { conversation_id: SCHUTZ_CONVERSATION_ID, question: QUESTION },
    });
    assert.deepEqual(consult, {
      status: SCHUTZ_HTTP_PAYMENT_REQUIRED,
      body: { error: "budget_tenant" },
    });

    const lookup = await webhookAntwort(srv, {
      pfad: LOOKUP_PATH,
      body: { conversation_id: SCHUTZ_CONVERSATION_ID, query: LOOKUP_QUERY },
    });
    assert.deepEqual(lookup, {
      status: SCHUTZ_HTTP_PAYMENT_REQUIRED,
      body: { error: "budget_tenant" },
    });

    assert.equal(
      consultCount(callOf(srv, SCHUTZ_CALL_ID)),
      0,
      "bei gerissener Decke entsteht kein Consult",
    );
  } finally {
    await srv.stop();
  }
});

const BINDUNGS_TOKEN_LAENGE = 32;
const INIT_PATH = "/webhooks/elevenlabs/init";
const INIT_TOKEN_HEADER = "x-hermes-init-token";
const INIT_AGENT_ID = "agent_el_schutz";
const INIT_CALL_ID = "call_el_init_schutz";
const INIT_BINDUNGS_TOKEN = "b".repeat(BINDUNGS_TOKEN_LAENGE);
const UNBEKANNTES_BINDUNGS_TOKEN = "c".repeat(BINDUNGS_TOKEN_LAENGE);
const INIT_CONVERSATION_ID = "conv_el_init_schutz";
const FRISCH_BEANTWORTET_S = 2;

const initSeedMitDefekterNummernliste = () => {
  const seed = spawnSeedWartenderElCall({
    callId: INIT_CALL_ID,
    bindungsToken: INIT_BINDUNGS_TOKEN,
    answeredVorS: FRISCH_BEANTWORTET_S,
  });
  seed.numbers = [
    {
      id: "num_owner_seed",
      e164: OWNER_TEST_NUMBER.e164,
      tenantId: BOOTSTRAP_TENANT_ID,
      provider: OWNER_TEST_NUMBER.provider,
      status: "active",
      providerNumberId: null,
    },
    null,
  ];
  return seed;
};

const initAntwort = async (srv, { token, bindung }) => {
  const res = await abrufMitFrist(`${srv.localUrl}${INIT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [INIT_TOKEN_HEADER]: token },
    body: JSON.stringify(
      initBindungsKoerper({
        bindung,
        agentId: INIT_AGENT_ID,
        conversationId: INIT_CONVERSATION_ID,
      }),
    ),
  });
  return { status: res.status, body: await res.json() };
};

test("[NIE2] Init-Webhook antwortet mit 403 verweigert, 404 kein_laufender_anruf und 500 intern", async () => {
  const env = elInboundInitSpawnEnv(INIT_AGENT_ID);
  const srv = await startServer({ env, seed: initSeedMitDefekterNummernliste() });
  try {
    const falschesToken = await initAntwort(srv, {
      token: "f".repeat(env.ELEVENLABS_INIT_WEBHOOK_TOKEN.length),
      bindung: INIT_BINDUNGS_TOKEN,
    });
    assert.deepEqual(falschesToken, {
      status: SCHUTZ_HTTP_FORBIDDEN,
      body: { error: "verweigert" },
    });

    const ohneWartendenAnruf = await initAntwort(srv, {
      token: env.ELEVENLABS_INIT_WEBHOOK_TOKEN,
      bindung: UNBEKANNTES_BINDUNGS_TOKEN,
    });
    assert.deepEqual(ohneWartendenAnruf, {
      status: HTTP_NOT_FOUND,
      body: { error: "kein_laufender_anruf" },
    });

    const innererFehler = await initAntwort(srv, {
      token: env.ELEVENLABS_INIT_WEBHOOK_TOKEN,
      bindung: INIT_BINDUNGS_TOKEN,
    });
    assert.deepEqual(innererFehler, {
      status: SCHUTZ_HTTP_SERVER_ERROR,
      body: { error: "intern" },
    });
  } finally {
    await srv.stop();
  }
});

const CONFIRMATION_PATH = "/api/call-confirmations";
const CONFIRMATION_SECRET = "s".repeat(CONFIRMATION_SECRET_MIN_LENGTH);
const CONFIRMATION_TO = "+4915112345678";
const CONFIRMATION_OBJECTIVE = "Termin beim Friseur vereinbaren";
const FALSCHER_CODE = "000000";
const IDENTITAET_OHNE_TENANT = "sub-ohne-tenant-schutz";

const bestaetigung = async (srv, body, headers = {}) => {
  const res = await abrufMitFrist(`${srv.localUrl}${CONFIRMATION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("[NIE3] Anrufbestaetigung antwortet mit 400, 403 und 503, Sprachroute mit 404 fuer fehlendes Audio und 403 ohne Signatur", async () => {
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", MULTI_TENANT: "true" },
  });
  try {
    const ohneObjective = await bestaetigung(srv, { to: CONFIRMATION_TO });
    assert.deepEqual(ohneObjective, {
      status: SCHUTZ_HTTP_BAD_REQUEST,
      body: { error: "to und objective sind Pflicht" },
    });

    const ohneTenant = await bestaetigung(
      srv,
      { to: CONFIRMATION_TO, objective: CONFIRMATION_OBJECTIVE },
      { "X-Internal-Identity": IDENTITAET_OHNE_TENANT },
    );
    assert.deepEqual(ohneTenant, {
      status: SCHUTZ_HTTP_FORBIDDEN,
      body: { error: "Kein Tenant fuer diese Identitaet." },
    });

    const ohneGeheimnis = await bestaetigung(srv, {
      to: CONFIRMATION_TO,
      objective: CONFIRMATION_OBJECTIVE,
    });
    assert.deepEqual(ohneGeheimnis, {
      status: SCHUTZ_HTTP_SERVICE_UNAVAILABLE,
      body: { reason: "confirmation_unavailable" },
    });

    const audio = await abrufMitFrist(`${srv.localUrl}/voice/tts/unbekanntes-audio-token`);
    assert.equal(audio.status, HTTP_NOT_FOUND, "fehlendes Audio ist 404");
    assert.equal(await audio.text(), "", "fehlendes Audio hat keinen Koerper");

    const ohneSignatur = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, { method: "POST" });
    assert.equal(ohneSignatur.status, SCHUTZ_HTTP_FORBIDDEN, "ungueltige Inbound-Signatur ist 403");
    assert.equal(await ohneSignatur.text(), "invalid inbound signature");

    assert.equal(srv.readStore().calls.length, 0, "keine Ablehnung waehlt einen Anruf");
  } finally {
    await srv.stop();
  }
});

test("[NIE3] Anrufbestaetigung antwortet bei Erfolg mit 200, und ohne gueltige Bestaetigung wird nicht gewaehlt", async () => {
  const srv = await startServer({ env: { CALL_CONFIRMATION_SECRET: CONFIRMATION_SECRET } });
  try {
    const anfrage = { to: CONFIRMATION_TO, objective: CONFIRMATION_OBJECTIVE };
    const ausgestellt = await bestaetigung(srv, anfrage);
    assert.equal(ausgestellt.status, SCHUTZ_HTTP_OK);
    assert.equal(typeof ausgestellt.body.confirmation?.code, "string", "ein Code wird ausgestellt");

    const falsch = await bestaetigung(srv, { ...anfrage, confirmation_code: FALSCHER_CODE });
    assert.equal(falsch.status, SCHUTZ_HTTP_OK);
    assert.equal(falsch.body.confirmed, false, "ein falscher Code bestaetigt nicht");

    const richtig = await bestaetigung(srv, {
      ...anfrage,
      confirmation_code: ausgestellt.body.confirmation.code,
    });
    assert.equal(richtig.status, SCHUTZ_HTTP_OK);
    assert.equal(richtig.body.confirmed, true, "der ausgestellte Code bestaetigt");

    assert.equal(srv.readStore().calls.length, 0, "die Bestaetigung allein waehlt keinen Anruf");
  } finally {
    await srv.stop();
  }
});
