// ---- IEL-B6: Conversation-Initiation-Webhook (POST /webhooks/elevenlabs/init) -------------
// Die Route wird IN-PROCESS an einem echten HTTP-Server auf Port 0 gemountet (Muster
// test/el-consult-timeout-spur.test.js): ein Gate, das nur in einer Funktion sitzt, aber nicht
// an der Route haengt, misst sonst gruen. Store = echte state-ops-Mutatoren, Uhr = Attrappe
// (Wiederholungsfrist K1), Fristen = Recorder. Test 14 belegt die Verdrahtung am echten Server.
//
// Namen beginnen mit "IEL-B6-<n>: " bzw. "IEX-A3-<n>: " (Eroeffnungs-Riegel) - trifft weder
// i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import {
  EL_CALL_BINDING_SIP_HEADER,
  EL_CALL_BINDING_VARIABLE,
  INITIATION_RESPONSE_TYPE,
  SIP_HEADERS_FORM,
  buildInitiationResponse,
  callBindingTokenOf,
  inboundElLocaleOf,
  sipHeadersFormOf,
} from "../src/elevenlabs/inbound-initiation.js";
import { INIT_WEBHOOK_TOKEN_MIN_LENGTH, zugangsFingerabdruck } from "../src/elevenlabs/inbound-path-decision.js";
import { INBOUND_EL_SCOPE } from "../src/elevenlabs/inbound-scope.js";
import { hasInboundNotice } from "../src/i18n/inbound-notice.js";
import { LOCALES, localeFor } from "../src/i18n/locales.js";
import {
  ELEVENLABS_INIT_PATH,
  EL_INIT_WIEDERHOLUNG_FRIST_MS,
  INIT_ANTWORT,
  INIT_TOKEN_HEADER,
  makeElevenLabsInitWebhookRoutes,
} from "../src/routes/webhooks-elevenlabs-init.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { templatePlaceholderNames } from "./helpers/el-vorlage-variablen.mjs";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  captureConsole,
  startServer,
  storeOpsFacade,
  waitForStoreState,
} from "./helpers.js";
import {
  INBOUND_FROM,
  INBOUND_TO,
  TRAEGER_SID,
  elInboundInitSpawnEnv,
  initBindungsKoerper,
  seedWartenderElCall,
  spawnSeedWartenderElCall,
} from "./_iel-inbound-harness.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

const INIT_TOKEN = "i".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH);
const ZU_KURZES_TOKEN = "i".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH - 1);
const AGENT_ID = "agent_iel_b6";
const OWNER_NAME = "Jonas Beispiel";
// Die Platzhalter-Syntax des Anbieters im Namen - der echte Datendefekt (d) der Eroeffnung.
const PLATZHALTER_NAME = "Jonas {{x}}";
const NAMENS_TEIL = "Jonas";
const ANNAHME_VOR_MS = 1500;
const CONV_A = "conv_b6_a";
const CONV_B = "conv_b6_b";
const KEINE_KOPFZEILEN_FORM = Number.MAX_SAFE_INTEGER;
const FALSCHES_BINDUNGS_TOKEN = "0123456789abcdef0123456789abcdef";
const FAKE_START_MS = Date.parse("2026-09-15T10:00:00.000Z");
const FRISCH_BEANTWORTET_S = 2;
const ERWARTETE_VARIABLEN = 16;
const GATE_UNAVAILABLE = "unavailable";
const VORLAGE_DE = LOCALES.de;
const VORLAGE_EN = LOCALES.en;

// ---- Build ----------------------------------------------------------------------------------

function baueConfig({
  enabled = true,
  tenantIds = [BOOTSTRAP_TENANT_ID],
  initWebhookToken = INIT_TOKEN,
  agentId = AGENT_ID,
  scope = INBOUND_EL_SCOPE.ALLOWLIST,
} = {}) {
  return {
    voice: {
      elevenLabsInbound: {
        enabled,
        tenantIds,
        scope,
        sipUser: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER,
        sipPassword: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD,
        initWebhookToken,
      },
      elevenLabsOutbound: { agentId },
    },
    telnyx: { telnyxElevenLabs: { voiceId: "" } },
  };
}

// Die echte Store-Fassade plus genau die Leser, die Route und Builder fragen.
function baueInitStore(state) {
  return {
    ...storeOpsFacade(state),
    bindInboundElConversation: (id, bindung) => ops.bindInboundElConversation(state, id, bindung),
    numberRecordByE164: (e164) => ops.numberRecordByE164(state, e164),
    tenantTimezone: (id) => ops.tenantTimezone(state, id),
    tenantContext: (id) => ops.tenantContext(state, "", id),
  };
}

function baueZustand({ ownerName = OWNER_NAME } = {}) {
  const state = ops.makeDefaultState();
  state.tenants[0].ownerName = ownerName;
  state.numbers.push({
    id: "num_b6",
    e164: INBOUND_TO,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  const call = seedWartenderElCall(state, { answeredVorS: FRISCH_BEANTWORTET_S });
  return { state, call };
}

// storeUeberschreibung ersetzt einzelne Leser/Mutatoren (Spion, werfender Leser).
async function mitInitRoute({ state, config = baueConfig(), storeUeberschreibung = {} }, run) {
  const uhr = { nowMs: FAKE_START_MS };
  const stelleUhr = (nowMs) => Object.assign(uhr, { nowMs });
  const geloescht = [];
  const store = { ...baueInitStore(state), ...storeUeberschreibung };
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsInitWebhookRoutes({
      store,
      config,
      bridges: { clearDeadlines: (callId) => geloescht.push(callId) },
      now: () => uhr.nowMs,
    }),
  );
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}${ELEVENLABS_INIT_PATH}`;
  try {
    return await run({ url, stelleUhr, geloescht, store, config });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const initBody = ({ bindung, conversationId = CONV_A, agentId = AGENT_ID, extra = {} }) => ({
  ...initBindungsKoerper({ bindung, agentId, conversationId }),
  ...extra,
});

async function initAnfrage(url, { token = INIT_TOKEN, body }) {
  const headers = { "content-type": "application/json" };
  if (token !== null) headers[INIT_TOKEN_HEADER] = token;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

// Ein Fall mit frischem Zustand und frischer Route.
async function einzelFall({ config = baueConfig(), body = null, zustand = baueZustand(), storeUeberschreibung = {} } = {}) {
  return mitInitRoute({ state: zustand.state, config, storeUeberschreibung }, async (route) => {
    const antwort = await initAnfrage(route.url, { body: body ?? initBody({ bindung: zustand.call.streamToken }) });
    return { ...antwort, ...zustand, ...route };
  });
}

// ---- Stufe 1: Geheimnis -----------------------------------------------------------------------

test("IEL-B6-1: Init-Token fehlt, leer oder falsch -> 403 mit konstantem Koerper, Store unveraendert", async () => {
  const { state, call } = baueZustand();
  const vorher = JSON.stringify(state);
  await mitInitRoute({ state }, async ({ url }) => {
    for (const token of [null, "", "x".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH)]) {
      const antwort = await initAnfrage(url, { token, body: initBody({ bindung: call.streamToken }) });
      assert.equal(antwort.status, HTTP_FORBIDDEN, `token=${JSON.stringify(token)}`);
      assert.equal(antwort.text, JSON.stringify(INIT_ANTWORT.VERWEIGERT));
    }
  });
  assert.equal(JSON.stringify(state), vorher);
});

test("IEL-B6-2: ein konfiguriertes Token unter der Mindestlaenge oder leer gilt als leer -> 403 fuer jeden Aufruf", async () => {
  for (const initWebhookToken of [ZU_KURZES_TOKEN, ""]) {
    const { state, call } = baueZustand();
    await mitInitRoute({ state, config: baueConfig({ initWebhookToken }) }, async ({ url }) => {
      const antwort = await initAnfrage(url, { token: initWebhookToken, body: initBody({ bindung: call.streamToken }) });
      assert.equal(antwort.status, HTTP_FORBIDDEN, `konfiguriert laenge=${initWebhookToken.length}`);
    });
    assert.equal(call.elevenlabsConversationId, null);
  }
});

// ---- Stufe 2: Zuordnung (R-B) -----------------------------------------------------------------

function baueRbZustand() {
  const zustand = baueZustand();
  const { state } = zustand;
  const budget = ops.createCall(state, { direction: "inbound", from: INBOUND_FROM, to: INBOUND_TO, twilioSid: TRAEGER_SID, tenantId: BOOTSTRAP_TENANT_ID });
  ops.recordCostProfile(state, budget.id, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
  const rueckfall = seedWartenderElCall(state, { answeredVorS: FRISCH_BEANTWORTET_S });
  ops.markInboundElFallback(state, rueckfall.id, new Date().toISOString());
  const beendet = seedWartenderElCall(state, { answeredVorS: FRISCH_BEANTWORTET_S });
  ops.endCallRecord(state, beendet.id, "completed");
  const fremdGebunden = seedWartenderElCall(state, { answeredVorS: FRISCH_BEANTWORTET_S });
  ops.bindInboundElConversation(state, fremdGebunden.id, { conversationId: CONV_B, nowIso: new Date(FAKE_START_MS).toISOString() });
  return { ...zustand, budget, rueckfall, beendet, fremdGebunden };
}

test("IEL-B6-3: jede Ablehnung der Zuordnung ist 404 mit byte-gleichem Koerper ohne Daten, keine Bindung", async () => {
  const zustand = baueRbZustand();
  const { state } = zustand;
  const konversationenVorher = state.calls.map((eintrag) => eintrag.elevenlabsConversationId);
  const faelle = {
    fehlt: initBody({ bindung: undefined }),
    leer: initBody({ bindung: "" }),
    falsch: initBody({ bindung: FALSCHES_BINDUNGS_TOKEN }),
    budget: initBody({ bindung: zustand.budget.streamToken }),
    rueckfall: initBody({ bindung: zustand.rueckfall.streamToken }),
    nichtAktiv: initBody({ bindung: zustand.beendet.streamToken }),
    gebundenAndereId: initBody({ bindung: zustand.fremdGebunden.streamToken }),
  };
  await mitInitRoute({ state }, async ({ url }) => {
    for (const [name, body] of Object.entries(faelle)) {
      const antwort = await initAnfrage(url, { body });
      assert.equal(antwort.status, HTTP_NOT_FOUND, name);
      assert.equal(antwort.text, JSON.stringify(INIT_ANTWORT.KEIN_ANRUF), name);
      for (const verboten of ["dynamic_variables", "owner_name", OWNER_NAME, BOOTSTRAP_TENANT_ID])
        assert.ok(!antwort.text.includes(verboten), `${name}: ${verboten} im Koerper`);
    }
  });
  assert.deepEqual(state.calls.map((eintrag) => eintrag.elevenlabsConversationId), konversationenVorher);
});

test("IEL-B6-4: fremde oder unkonfigurierte agent_id und abweichende called_number -> 404", async () => {
  const fremd = baueZustand();
  const fremdeAgentId = await einzelFall({ zustand: fremd, body: initBody({ bindung: fremd.call.streamToken, agentId: "agent_fremd" }) });
  assert.equal(fremdeAgentId.status, HTTP_NOT_FOUND);
  assert.equal((await einzelFall({ config: baueConfig({ agentId: "" }) })).status, HTTP_NOT_FOUND);
  const abweichend = baueZustand();
  const andereNummer = await einzelFall({
    zustand: abweichend,
    body: initBody({ bindung: abweichend.call.streamToken, extra: { called_number: "+491709999999" } }),
  });
  assert.equal(andereNummer.status, HTTP_NOT_FOUND);
  assert.equal(abweichend.call.elevenlabsConversationId, null);
});

test("IEL-B6-4b: called_number fehlt oder ist nur anders geschrieben -> 200", async () => {
  const ohne = baueZustand();
  const ohneNummer = await einzelFall({ zustand: ohne, body: initBody({ bindung: ohne.call.streamToken, extra: { called_number: undefined } }) });
  assert.equal(ohneNummer.status, HTTP_OK);
  const formatiert = baueZustand();
  const mitTrennern = await einzelFall({
    zustand: formatiert,
    body: initBody({ bindung: formatiert.call.streamToken, extra: { called_number: "+49 170-000 0000" } }),
  });
  assert.equal(mitTrennern.status, HTTP_OK);
});

// ---- Stufe 3: Schalter ------------------------------------------------------------------------

test("IEL-B6-5: Schalter aus oder Tenant nicht gepinnt -> 404, keine Bindung", async () => {
  for (const config of [baueConfig({ enabled: false }), baueConfig({ tenantIds: [] })]) {
    const ergebnis = await einzelFall({ config });
    assert.equal(ergebnis.status, HTTP_NOT_FOUND);
    assert.equal(ergebnis.text, JSON.stringify(INIT_ANTWORT.KEIN_ANRUF));
    assert.equal(ergebnis.call.elevenlabsConversationId, null);
  }
});

// ---- Treffer ----------------------------------------------------------------------------------

test("IEL-B6-6a: Treffer -> 200, Variablenmenge = Vorlage, Inbound-Leerwerte, kein Werkzeug-Token", async () => {
  const ergebnis = await einzelFall();
  assert.equal(ergebnis.status, HTTP_OK);
  const antwort = JSON.parse(ergebnis.text);
  const variablen = antwort.dynamic_variables;
  assert.equal(antwort.type, INITIATION_RESPONSE_TYPE);
  assert.equal(Object.keys(variablen).length, ERWARTETE_VARIABLEN);
  assert.deepEqual(Object.keys(variablen).sort(), [...templatePlaceholderNames()].sort());
  for (const leer of ["tenant_token", "voicemail_line", "callee", "objective", "opening_line"])
    assert.equal(variablen[leer], "", leer);
  assert.equal(variablen.consult_available, GATE_UNAVAILABLE);
  assert.equal(variablen.lookup_available, GATE_UNAVAILABLE);
  assert.ok(variablen.inbound_situation.includes(OWNER_NAME));
  assert.ok(!variablen.inbound_situation.includes("{{"));
});

test("IEL-B6-6b: Treffer -> first_message = inboundEroeffnung(ownerName) der aufgeloesten Sprache, Sprache und Stimme aus inboundElLocaleOf", async () => {
  const ergebnis = await einzelFall();
  const override = JSON.parse(ergebnis.text).conversation_config_override;
  const locale = inboundElLocaleOf({ store: ergebnis.store, config: ergebnis.config, call: ergebnis.call });
  assert.equal(override.agent.first_message, VORLAGE_DE.inboundEroeffnung(OWNER_NAME));
  assert.equal(override.agent.language, locale.language);
  assert.equal(locale.language, VORLAGE_DE.language);
  assert.equal(override.tts.voice_id, locale.voiceId);
  assert.equal(hasInboundNotice(override.agent.first_message), true);
});

test("IEL-B6-6c: Treffer -> Bindung am Datensatz mit der Uhr der Route, Fristen genau einmal geloescht", async () => {
  const ergebnis = await einzelFall();
  assert.equal(ergebnis.call.elevenlabsConversationId, CONV_A);
  assert.equal(ergebnis.call.elBoundAt, new Date(FAKE_START_MS).toISOString());
  assert.deepEqual(ergebnis.geloescht, [ergebnis.call.id]);
});

// Abweichung vom Plan (Test 7 "de ohne Default-Stimme -> kein tts"): jede unterstuetzte
// Sprache hat heute eine eigene Profil-Stimme (ELEVENLABS_VOICE_ID_BY_PROFILE), der leere
// Zweig ist mit echten Locales nicht erreichbar. Gemessen wird deshalb die Sprachfolge.
test("IEL-B6-7: die Stimme folgt der Anrufsprache (de und en je mit ihrer Profil-Stimme)", async () => {
  const deutsch = await einzelFall();
  const englischZustand = baueZustand();
  englischZustand.call.language = "en";
  const englisch = await einzelFall({ zustand: englischZustand });
  const overrideDe = JSON.parse(deutsch.text).conversation_config_override;
  const overrideEn = JSON.parse(englisch.text).conversation_config_override;
  assert.equal(overrideEn.agent.language, VORLAGE_EN.language);
  assert.notEqual(overrideDe.tts.voice_id, overrideEn.tts.voice_id);
  const localeEn = inboundElLocaleOf({ store: englisch.store, config: englisch.config, call: englisch.call });
  assert.equal(overrideEn.tts.voice_id, localeEn.voiceId);
});

test("IEL-B6-8: Bindungs-Token als Objekt (klein), als Liste oder als dynamische Variable -> 200; ohne jede Quelle 404", async () => {
  const formen = [
    (token) => ({ sip_headers: { [EL_CALL_BINDING_SIP_HEADER.toLowerCase()]: token } }),
    (token) => ({ sip_headers: [{ name: EL_CALL_BINDING_SIP_HEADER, value: token }] }),
    (token) => ({ sip_headers: undefined, dynamic_variables: { [EL_CALL_BINDING_VARIABLE]: token } }),
  ];
  for (const form of formen) {
    const zustand = baueZustand();
    const body = { ...initBody({ bindung: undefined }), ...form(zustand.call.streamToken) };
    assert.equal((await einzelFall({ zustand, body })).status, HTTP_OK, JSON.stringify(Object.keys(body)));
  }
  const ohneQuelle = await einzelFall({ body: { ...initBody({ bindung: undefined }), sip_headers: undefined } });
  assert.equal(ohneQuelle.status, HTTP_NOT_FOUND);
});

// ---- Wiederholung (K1) ------------------------------------------------------------------------

async function mitGebundenemCall(run) {
  const { state, call } = baueZustand();
  await mitInitRoute({ state }, async (route) => {
    const body = initBody({ bindung: call.streamToken });
    const erste = await initAnfrage(route.url, { body });
    assert.equal(erste.status, HTTP_OK);
    await run({ ...route, state, call, body, erste });
  });
}

test("IEL-B6-9a: Wiederholung knapp vor Fristende -> dieselbe Antwort, keine neue Bindung, Fristen unberuehrt", async () => {
  await mitGebundenemCall(async ({ url, stelleUhr, geloescht, call, body, erste }) => {
    const gebundenUm = call.elBoundAt;
    stelleUhr(FAKE_START_MS + EL_INIT_WIEDERHOLUNG_FRIST_MS - 1);
    const zweite = await initAnfrage(url, { body });
    assert.equal(zweite.status, HTTP_OK);
    assert.deepEqual(JSON.parse(zweite.text), JSON.parse(erste.text));
    assert.equal(geloescht.length, 1);
    assert.equal(call.elBoundAt, gebundenUm);
  });
});

test("IEL-B6-9b: Wiederholung ab Fristende -> 404 ohne Daten", async () => {
  await mitGebundenemCall(async ({ url, stelleUhr, body }) => {
    stelleUhr(FAKE_START_MS + EL_INIT_WIEDERHOLUNG_FRIST_MS);
    const spaet = await initAnfrage(url, { body });
    assert.equal(spaet.status, HTTP_NOT_FOUND);
    assert.equal(spaet.text, JSON.stringify(INIT_ANTWORT.KEIN_ANRUF));
  });
});

test("IEL-B6-9c: gleiches Token mit anderer conversation_id innerhalb der Frist -> 404, Bindung unveraendert", async () => {
  await mitGebundenemCall(async ({ url, call }) => {
    const andere = await initAnfrage(url, { body: initBody({ bindung: call.streamToken, conversationId: CONV_B }) });
    assert.equal(andere.status, HTTP_NOT_FOUND);
    assert.equal(call.elevenlabsConversationId, CONV_A);
  });
});

test("IEL-B6-9d: anderes Token mit gleicher conversation_id innerhalb der Frist -> 404", async () => {
  await mitGebundenemCall(async ({ url }) => {
    const fremd = await initAnfrage(url, { body: initBody({ bindung: FALSCHES_BINDUNGS_TOKEN }) });
    assert.equal(fremd.status, HTTP_NOT_FOUND);
  });
});

test("IEL-B6-10: Neustart waehrend GEBUNDEN -> die Wiederholung binnen Frist liefert dieselbe Antwort ohne zweite Bindung", async () => {
  const { state, call } = baueZustand();
  const body = initBody({ bindung: call.streamToken });
  const erste = await mitInitRoute({ state }, ({ url }) => initAnfrage(url, { body }));
  const nachNeustart = JSON.parse(JSON.stringify(state));
  await mitInitRoute({ state: nachNeustart }, async ({ url, geloescht }) => {
    const zweite = await initAnfrage(url, { body });
    assert.equal(zweite.status, HTTP_OK);
    assert.deepEqual(JSON.parse(zweite.text), JSON.parse(erste.text));
    assert.deepEqual(geloescht, []);
  });
  assert.equal(ops.getCall(nachNeustart, call.id).elBoundAt, call.elBoundAt);
});

// ---- Log und Fehlerpfad -----------------------------------------------------------------------

test("IEL-B6-11: das Log nennt Grund, bereinigte Schluesselnamen und sip_headers-Form - nie Token, Kennung oder Namen", async () => {
  const { state, call } = baueZustand();
  const zeilen = await captureConsole(() =>
    mitInitRoute({ state }, async ({ url }) => {
      await initAnfrage(url, { token: null, body: initBody({ bindung: call.streamToken }) });
      await initAnfrage(url, { body: { ...initBody({ bindung: FALSCHES_BINDUNGS_TOKEN }), "boeser\nschluessel": 1 } });
      await initAnfrage(url, { body: initBody({ bindung: call.streamToken }) });
    }),
  );
  const log = zeilen.join("\n");
  assert.ok(zeilen.includes("[el-init] abgelehnt grund=token"));
  const ablehnung = zeilen.find((zeile) => zeile.includes("grund=kein_wartender_anruf"));
  assert.ok(ablehnung.includes("boeser_schluessel"));
  assert.ok(ablehnung.includes(`sip_headers=${SIP_HEADERS_FORM.OBJEKT}`));
  assert.ok(ablehnung.includes("schluessel=agent_id,boeser_schluessel,called_number,conversation_id,sip_headers"));
  assert.ok(zeilen.some((zeile) => zeile.startsWith(`[el-init] gebunden call=${call.id} ms_seit_annahme=`)));
  for (const geheim of [INIT_TOKEN, call.streamToken, CONV_A, OWNER_NAME, "boeser\nschluessel"])
    assert.ok(!log.includes(geheim), `Log enthaelt ${JSON.stringify(geheim)}`);
});

// Der Eroeffnungs-Riegel laeuft VOR der Bindung (IEX-A3-5); danach koennen noch Store-Leser und
// Zeitkontext werfen - belegt am werfenden tenantTimezone.
test("IEL-B6-12: Builder wirft nach der Bindung -> 500 ohne Daten (Restrisiko: Call bleibt GEBUNDEN)", async () => {
  const ergebnis = await einzelFall({
    storeUeberschreibung: {
      tenantTimezone: () => {
        throw new Error("zeitzone nicht lesbar");
      },
    },
  });
  assert.equal(ergebnis.status, HTTP_SERVER_ERROR);
  assert.equal(ergebnis.text, JSON.stringify(INIT_ANTWORT.INTERN));
  assert.ok(!ergebnis.text.includes("dynamic_variables"));
  assert.equal(ergebnis.call.elevenlabsConversationId, CONV_A);
});

// ---- Reine Bausteine --------------------------------------------------------------------------

test("IEL-B6-13b: callBindingTokenOf und sipHeadersFormOf ueber alle Formen", () => {
  const token = FALSCHES_BINDUNGS_TOKEN;
  const faelle = [
    { body: { sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token } }, form: SIP_HEADERS_FORM.OBJEKT, erwartet: token },
    { body: { sip_headers: [{ name: EL_CALL_BINDING_SIP_HEADER.toUpperCase(), value: token }] }, form: SIP_HEADERS_FORM.LISTE, erwartet: token },
    { body: {}, form: SIP_HEADERS_FORM.FEHLT, erwartet: "" },
    { body: { sip_headers: KEINE_KOPFZEILEN_FORM }, form: SIP_HEADERS_FORM.UNBEKANNT, erwartet: "" },
    { body: { sip_headers: null }, form: SIP_HEADERS_FORM.FEHLT, erwartet: "" },
  ];
  for (const fall of faelle) {
    assert.equal(sipHeadersFormOf(fall.body), fall.form, JSON.stringify(fall.body));
    assert.equal(callBindingTokenOf(fall.body), fall.erwartet, JSON.stringify(fall.body));
  }
});

// ---- IEX-A3: Eroeffnungs-Riegel an der Route und im Builder ----------------------------------

// Spion auf die set-once-Bindung: zaehlt jeden Versuch, bindet danach echt.
function bindungsSpion(state) {
  const gebunden = [];
  const storeUeberschreibung = {
    bindInboundElConversation: (id, bindung) => {
      gebunden.push(id);
      return ops.bindInboundElConversation(state, id, bindung);
    },
  };
  return { gebunden, storeUeberschreibung };
}

const alsLog = (zeilen) => zeilen.join("\n");
const agentDerAntwort = (ergebnis) => JSON.parse(ergebnis.text).conversation_config_override.agent;

test("IEX-A3-5: Eroeffnung mit Platzhalter -> Stufe 3b lehnt VOR der Bindung ab (404, keine Bindung, keine Fristen, Log ohne Namen)", async () => {
  const zustand = baueZustand({ ownerName: PLATZHALTER_NAME });
  const { gebunden, storeUeberschreibung } = bindungsSpion(zustand.state);
  let ergebnis = null;
  const zeilen = await captureConsole(async () => {
    ergebnis = await einzelFall({ zustand, storeUeberschreibung });
  });
  assert.equal(ergebnis.status, HTTP_NOT_FOUND);
  assert.equal(ergebnis.text, JSON.stringify(INIT_ANTWORT.KEIN_ANRUF));
  assert.deepEqual(gebunden, []);
  assert.deepEqual(ergebnis.geloescht, []);
  assert.equal(zustand.call.elevenlabsConversationId, null);
  const ablehnung = zeilen.find((zeile) => zeile.includes("grund=eroeffnung"));
  assert.ok(ablehnung, alsLog(zeilen));
  assert.ok(ablehnung.includes(`call=${zustand.call.id}`));
  assert.ok(!alsLog(zeilen).includes(NAMENS_TEIL));
});

test("IEX-A3-6: Positiv-Kontrolle (sauberer Name bindet genau einmal) und Stufenfolge (Schalter vor Riegel)", async () => {
  const sauber = baueZustand();
  const spion = bindungsSpion(sauber.state);
  const treffer = await einzelFall({ zustand: sauber, storeUeberschreibung: spion.storeUeberschreibung });
  assert.equal(treffer.status, HTTP_OK);
  assert.deepEqual(spion.gebunden, [sauber.call.id]);

  const zeilen = await captureConsole(() =>
    einzelFall({ config: baueConfig({ enabled: false }), zustand: baueZustand({ ownerName: PLATZHALTER_NAME }) }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes("grund=schalter")), alsLog(zeilen));
  assert.ok(!zeilen.some((zeile) => zeile.includes("grund=eroeffnung")));
});

test("IEX-A3-7: der Builder riegelt den fertigen Koerper erneut - der Wurf nennt eroeffnung.platzhalter, nie den Namen", () => {
  const { state, call } = baueZustand({ ownerName: PLATZHALTER_NAME });
  assert.throws(
    () => buildInitiationResponse({ store: baueInitStore(state), config: baueConfig(), call }),
    (err) => err.message.includes("eroeffnung.platzhalter") && !err.message.includes(NAMENS_TEIL),
  );
});

test("IEX-A3-8: eine Sprachquelle fuer Text, agent.language und Aufloesung; ohne Namen die O4-Form", async () => {
  const unbekannt = baueZustand();
  unbekannt.call.language = "xx";
  const ergebnis = await einzelFall({ zustand: unbekannt });
  const agent = agentDerAntwort(ergebnis);
  const locale = inboundElLocaleOf({ store: ergebnis.store, config: ergebnis.config, call: ergebnis.call });
  assert.equal(agent.language, localeFor(agent.language).language);
  assert.equal(agent.language, locale.language);
  assert.equal(agent.first_message, localeFor(agent.language).inboundEroeffnung(OWNER_NAME));

  const ohneName = await einzelFall({ zustand: baueZustand({ ownerName: "" }) });
  const eroeffnung = agentDerAntwort(ohneName).first_message;
  assert.equal(eroeffnung, VORLAGE_DE.inboundEroeffnung(""));
  // IEP-P6 (Owner-Entscheidung 9): der Gruss steht vor der Selbstvorstellung.
  assert.ok(eroeffnung.startsWith("Hallo, hier ist ein KI-Assistent."));
});

// IEP-P6: dieselbe Route, derselbe Riegel - nur mit gesetztem callerIsOwner. Der Beleg, dass
// die Owner-Fassung ueber die ECHTE Init-Route spricht und der Riegel sie durchlaesst.
test("IEX-A3-8b: callerIsOwner=true -> Owner-Eroeffnung als first_message; ohne das Feld die Fremd-Fassung", async () => {
  const owner = baueZustand();
  owner.call.callerIsOwner = true;
  const mitOwner = agentDerAntwort(await einzelFall({ zustand: owner }));
  assert.equal(mitOwner.first_message, VORLAGE_DE.inboundEroeffnungOwner("Jonas"));

  const fremd = agentDerAntwort(await einzelFall({ zustand: baueZustand() }));
  assert.equal(fremd.first_message, VORLAGE_DE.inboundEroeffnung(OWNER_NAME));
});

test("IEX-A3-9: [el-init] gebunden traegt ms_seit_annahme deterministisch, die Wiederholung nicht", async () => {
  const { state, call } = baueZustand();
  call.answeredAt = new Date(FAKE_START_MS - ANNAHME_VOR_MS).toISOString();
  const body = initBody({ bindung: call.streamToken });
  const zeilen = await captureConsole(() =>
    mitInitRoute({ state }, async ({ url }) => {
      assert.equal((await initAnfrage(url, { body })).status, HTTP_OK);
      assert.equal((await initAnfrage(url, { body })).status, HTTP_OK);
    }),
  );
  assert.ok(zeilen.includes(`[el-init] gebunden call=${call.id} ms_seit_annahme=${ANNAHME_VOR_MS}`), alsLog(zeilen));
  assert.ok(zeilen.includes(`[el-init] wiederholung call=${call.id}`), alsLog(zeilen));
});

// ---- IEX-A9: Stufe 3 unter Scope registrierte_dids -------------------------------------------

const REGISTRIERT_CONFIG = baueConfig({ scope: INBOUND_EL_SCOPE.REGISTRIERTE_DIDS });
const BELEG_ZEITPUNKT = "2026-09-15T08:00:00.000Z";

function angerufeneNummer({ state, call }) {
  return state.numbers.find((eintrag) => eintrag.e164 === call.to);
}

// Die angerufene DID bekommt einen Beleg mit dem Fingerabdruck des laufenden Zugangs.
function mitBeleg(zustand) {
  const nummer = angerufeneNummer(zustand);
  nummer.elInboundTrunkBelegtAt = BELEG_ZEITPUNKT;
  nummer.elInboundTrunkZugangFp = zugangsFingerabdruck(EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER);
  return zustand;
}

async function belegFall(zustand) {
  const spion = bindungsSpion(zustand.state);
  let ergebnis = null;
  const zeilen = await captureConsole(async () => {
    ergebnis = await einzelFall({ config: REGISTRIERT_CONFIG, zustand, storeUeberschreibung: spion.storeUeberschreibung });
  });
  return { ergebnis, zeilen, gebunden: spion.gebunden };
}

function assertSchalterAblehnung({ ergebnis, zeilen, gebunden }, zustand) {
  assert.equal(ergebnis.status, HTTP_NOT_FOUND);
  assert.equal(ergebnis.text, JSON.stringify(INIT_ANTWORT.KEIN_ANRUF));
  const ablehnung = zeilen.find((zeile) => zeile.includes("grund=schalter"));
  assert.ok(ablehnung, alsLog(zeilen));
  assert.ok(ablehnung.includes(`call=${zustand.call.id}`));
  assert.deepEqual(gebunden, []);
  assert.equal(zustand.call.elevenlabsConversationId, null);
}

test("IEX-A9-10a: registrierte_dids, angerufene DID ohne Beleg -> Stufe 3 lehnt ab (404, grund=schalter, keine Bindung)", async () => {
  const zustand = baueZustand();
  assertSchalterAblehnung(await belegFall(zustand), zustand);
});

test("IEX-A9-10b: registrierte_dids, Beleg mit laufendem Fingerabdruck -> 200, genau eine Bindung (Positiv-Kontrolle)", async () => {
  const zustand = mitBeleg(baueZustand());
  const { ergebnis, gebunden } = await belegFall(zustand);
  assert.equal(ergebnis.status, HTTP_OK);
  assert.deepEqual(gebunden, [zustand.call.id]);
});

test("IEX-A9-10c: registrierte_dids, Beleg seit dem Anrufeingang weggefallen -> 404 grund=schalter", async () => {
  const zustand = mitBeleg(baueZustand());
  angerufeneNummer(zustand).elInboundTrunkBelegtAt = null;
  assertSchalterAblehnung(await belegFall(zustand), zustand);
});

// ---- Verdrahtung am echten Server -------------------------------------------------------------

const SPAWN_CALL_ID = "call_iel_b6_init";
const SPAWN_BINDUNGS_TOKEN = "fedcba9876543210fedcba9876543210";

test("IEL-B6-14: am echten Server ist die Route gemountet - ohne Init-Token 403, mit Bindungs-Token 200 und gebunden", async () => {
  const srv = await startServer({
    env: elInboundInitSpawnEnv(AGENT_ID),
    seed: spawnSeedWartenderElCall({
      callId: SPAWN_CALL_ID,
      bindungsToken: SPAWN_BINDUNGS_TOKEN,
      answeredVorS: FRISCH_BEANTWORTET_S,
    }),
  });
  try {
    const url = `${srv.localUrl}${ELEVENLABS_INIT_PATH}`;
    const body = initBody({ bindung: SPAWN_BINDUNGS_TOKEN });
    const ohneToken = await initAnfrage(url, { token: null, body });
    assert.equal(ohneToken.status, HTTP_FORBIDDEN);
    const mitToken = await initAnfrage(url, { token: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN, body });
    assert.equal(mitToken.status, HTTP_OK, mitToken.text);
    const stand = await waitForStoreState(srv, (zustand) =>
      zustand.calls.some((eintrag) => eintrag.id === SPAWN_CALL_ID && eintrag.elevenlabsConversationId === CONV_A),
    );
    assert.ok(stand);
  } finally {
    await srv.stop();
  }
});
