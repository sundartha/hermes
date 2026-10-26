import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_LAST_NAME,
  TELNYX_TEST_OWNER_NUMBER,
  TELNYX_TEST_PEER_NUMBER,
  seedState,
  startServer,
  waitForStoreState,
  waitUntil,
} from "../helpers.js";
import { DISCLOSURE_JONAS } from "../_outbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const AUFTRAG = "Tisch fuer zwei reservieren (GW0)";

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_gw0",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_gw0",
  ELEVENLABS_API_KEY: "el-gw0-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

async function aufDemElWeg({ env = {}, seed = seedState() } = {}, lauf) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url, ...env },
    seed,
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    return await lauf({ srv, anbieter });
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

function rufeAn(srv, auftrag = {}) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: AUFTRAG, ...auftrag }),
  });
}

const auftragsAnruf = (store) => store.calls.find((call) => call.goal === AUFTRAG);
const anrufAn = (srv, ziel) => srv.readStore().calls.find((call) => call.to === ziel);

async function abgelehnt(res, status, grund) {
  assert.equal(res.status, status);
  assert.equal((await res.json()).reason, grund);
}

async function nichtsGestartet({ srv, anbieter }, res, [status, grund]) {
  await abgelehnt(res, status, grund);
  assert.equal(anbieter.starts().length, 0, "der ElevenLabs-Start darf nie erreicht werden");
  assert.equal(auftragsAnruf(srv.readStore()), undefined, "kein Call-Datensatz");
}

test("GW0-DENYLIST: eine gesperrte Nummer erreicht den ElevenLabs-Start nie, eine normale schon", async () => {
  await aufDemElWeg({}, async ({ srv, anbieter }) => {
    await nichtsGestartet({ srv, anbieter }, await rufeAn(srv, { to: "+4990012345678" }), [HTTP_FORBIDDEN, "denylist"]);
    assert.equal((await rufeAn(srv)).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
  });
});

test("GW0-LAND: ein Ziel ausserhalb der erlaubten Laender erreicht den ElevenLabs-Start nie", async () => {
  await aufDemElWeg({ env: { ALLOWED_COUNTRY_CODES: "+43" } }, async ({ srv, anbieter }) => {
    await nichtsGestartet({ srv, anbieter }, await rufeAn(srv), [HTTP_FORBIDDEN, "land"]);
    assert.equal((await rufeAn(srv, { to: "+436641234567" })).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
  });
});

test("GW0-STUNDENLIMIT: der Anruf ueber dem Stundenlimit erreicht den ElevenLabs-Start nie", async () => {
  await aufDemElWeg({ env: { MAX_CALLS_PER_HOUR: "1" } }, async ({ srv, anbieter }) => {
    assert.equal((await rufeAn(srv, { to: "+4915112340001", objective: "Erster Anruf (GW0)" })).status, HTTP_OK);
    await abgelehnt(await rufeAn(srv), HTTP_TOO_MANY, "stundenlimit");
    assert.equal(anbieter.starts().length, 1);
    assert.equal(auftragsAnruf(srv.readStore()), undefined);
  });
});

test("GW0-ZIEL-LIMIT: der Anruf ueber dem Limit je Ziel erreicht den ElevenLabs-Start nie", async () => {
  await aufDemElWeg({ env: { PER_TARGET_CALL_CAP: "1" } }, async ({ srv, anbieter }) => {
    assert.equal((await rufeAn(srv, { objective: "Erster Anruf (GW0)" })).status, HTTP_OK);
    await abgelehnt(await rufeAn(srv), HTTP_TOO_MANY, "ziel_limit");
    assert.equal((await rufeAn(srv, { to: "+4915112340001" })).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 2);
  });
});

const DEPLOY_TOKEN = "gw0-anrufpause-deploy-token-mindestens-32";

async function setzePause(srv, an) {
  const res = await abrufMitFrist(`${srv.localUrl}/intern/anrufpause`, {
    method: "POST",
    headers: { Authorization: `Bearer ${DEPLOY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ an }),
  });
  assert.equal(res.status, HTTP_OK);
}

test("GW0-ANRUFPAUSE: waehrend der Anrufpause erreicht kein Anruf den ElevenLabs-Start, danach wieder", async () => {
  await aufDemElWeg({ env: { HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN } }, async ({ srv, anbieter }) => {
    await setzePause(srv, true);
    await nichtsGestartet({ srv, anbieter }, await rufeAn(srv), [HTTP_FORBIDDEN, "frozen"]);
    await setzePause(srv, false);
    assert.equal((await rufeAn(srv)).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
  });
});

const EIGENE_NUMMER = "+491713920012";
const AUFTRAGGEBER = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const eigeneNummerSeed = () =>
  seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: OWNER_TEST_FIRST_NAME,
        ownerName: AUFTRAGGEBER,
        privateNumber: EIGENE_NUMMER,
        defaultLanguage: "de",
      },
    ],
  });
const eigeneNummerEnv = (gepinnt) => ({
  OWNER_SELF_CALL_ENABLED: "true",
  OWNER_SELF_CALL_TENANT_IDS: gepinnt ? BOOTSTRAP_TENANT_ID : "",
});

function startVon(anbieter, ziel) {
  const start = anbieter.starts().find((a) => a.body.to_number === ziel);
  assert.ok(start, `kein ElevenLabs-Start an ${ziel}`);
  const daten = start.body.conversation_initiation_client_data;
  return { eroeffnung: daten.conversation_config_override?.agent?.first_message, variablen: daten.dynamic_variables };
}

function mitOffenlegung(srv, anbieter, ziel) {
  const { eroeffnung, variablen } = startVon(anbieter, ziel);
  assert.equal(eroeffnung, undefined, "ohne Ausnahme keine uebersteuerte Eroeffnung");
  assert.equal(variablen.callee_relation, "");
  assert.notEqual(anrufAn(srv, ziel).calleeIsOwner, true);
}

test("GW0-EIGENE-NUMMER: nur die eigene Nummer eines gepinnten Tenants spart den Offenlegungssatz, der Rueckfall bleibt", async () => {
  await aufDemElWeg({ env: eigeneNummerEnv(true), seed: eigeneNummerSeed() }, async ({ srv, anbieter }) => {
    assert.equal((await rufeAn(srv, { to: EIGENE_NUMMER })).status, HTTP_OK);
    assert.equal((await rufeAn(srv, { objective: "Fremder Anruf (GW0)" })).status, HTTP_OK);
    const { eroeffnung, variablen } = startVon(anbieter, EIGENE_NUMMER);
    assert.ok(eroeffnung.includes(OWNER_TEST_FIRST_NAME), "die Eroeffnung spricht den Auftraggeber an");
    assert.match(eroeffnung, /\bKI\b/, "die KI-Kennzeichnung entfaellt nicht");
    assert.ok(!eroeffnung.includes(DISCLOSURE_JONAS), "der Offenlegungssatz entfaellt");
    assert.ok(variablen.callee_relation.includes(DISCLOSURE_JONAS), "der Pflicht-Rueckfall traegt den vollen Satz");
    mitOffenlegung(srv, anbieter, TELNYX_TEST_PEER_NUMBER);
  });
});

test("GW0-EIGENE-NUMMER ohne Pin: die eigene Nummer eines nicht gepinnten Tenants bekommt den Offenlegungssatz", async () => {
  await aufDemElWeg({ env: eigeneNummerEnv(false), seed: eigeneNummerSeed() }, async ({ srv, anbieter }) => {
    assert.equal((await rufeAn(srv, { to: EIGENE_NUMMER })).status, HTTP_OK);
    mitOffenlegung(srv, anbieter, EIGENE_NUMMER);
  });
});

const KOSTENDECKE_CENT = 1000;
const RESTBUDGET_UNTER_DEN_LAUFENDEN_KOSTEN_CENT = 210;
const RESTBUDGET_UEBER_DEN_LAUFENDEN_KOSTEN_CENT = 230;
const TARIF_CENT = "20";
const LAUFENDER_ANRUF_MS = (9 * 60 + 5) * 1000;

function laufenderAnrufSeed(verbraucht) {
  const beginn = new Date(Date.now() - LAUFENDER_ANRUF_MS).toISOString();
  const seed = seedState({
    calls: [
      {
        id: "call_gw0_laufend",
        direction: "outbound",
        status: "active",
        tenantId: BOOTSTRAP_TENANT_ID,
        from: TELNYX_TEST_OWNER_NUMBER.e164,
        to: "+4915112340002",
        goal: "Laufender Anruf (GW0)",
        startedAt: beginn,
        answeredAt: beginn,
        maxDurationS: 1800,
      },
    ],
  });
  seed.usage = { [BOOTSTRAP_TENANT_ID]: { costCents: verbraucht } };
  return seed;
}

const WACHE_ENV = Object.freeze({
  DEFAULT_TENANT_BUDGET_CENTS: String(KOSTENDECKE_CENT),
  VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
  VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
  BUDGET_WATCHDOG_INTERVAL_MS: "200",
});

async function endeDesAuftragsAnrufs(srv) {
  const store = await waitForStoreState(srv, (s) => auftragsAnruf(s)?.status !== "active", 6000);
  return auftragsAnruf(store);
}

test("GW0-KOSTENDECKE im Gespraech: die Geld-Wache beendet einen laufenden EL-Anruf, sobald die Decke erreicht ist", async () => {
  await aufDemElWeg({ env: WACHE_ENV, seed: laufenderAnrufSeed(KOSTENDECKE_CENT - RESTBUDGET_UNTER_DEN_LAUFENDEN_KOSTEN_CENT) }, async ({ srv, anbieter }) => {
    assert.equal((await rufeAn(srv)).status, HTTP_OK);
    const anruf = await endeDesAuftragsAnrufs(srv);
    assert.equal(anruf.failureReason, "budget-exhausted");
    await waitUntil(() => anbieter.beendetGespraech(anruf.elevenlabsConversationId), { timeoutMs: 3000 });
  });
});

test("GW0-KOSTENDECKE im Gespraech Kontrolle: unter der Decke beendet die Geld-Wache den EL-Anruf nicht", async () => {
  await aufDemElWeg({ env: WACHE_ENV, seed: laufenderAnrufSeed(KOSTENDECKE_CENT - RESTBUDGET_UEBER_DEN_LAUFENDEN_KOSTEN_CENT) }, async ({ srv }) => {
    assert.equal((await rufeAn(srv, { max_duration_s: 2 })).status, HTTP_OK);
    assert.equal((await endeDesAuftragsAnrufs(srv)).failureReason, "max-duration-cap");
  });
});

const LANGER_AUFTRAG = "Laengerer Anruf (GW0)";
const LANGES_ZIEL = "+4915112340003";

test("GW0-MAXDAUER: ein EL-Anruf endet nach seiner Max-Dauer unter dem Anbieterdeckel, ein laengerer laeuft weiter", async () => {
  await aufDemElWeg({}, async ({ srv, anbieter }) => {
    const lang = await rufeAn(srv, { to: LANGES_ZIEL, objective: LANGER_AUFTRAG, max_duration_s: 30 });
    assert.equal(lang.status, HTTP_OK);
    assert.equal((await rufeAn(srv, { max_duration_s: 2 })).status, HTTP_OK);
    assert.equal(auftragsAnruf(srv.readStore()).status, "active");
    const anruf = await endeDesAuftragsAnrufs(srv);
    assert.equal(anruf.status, "completed");
    assert.equal(anruf.failureReason, "max-duration-cap");
    await waitUntil(() => anbieter.beendetGespraech(anruf.elevenlabsConversationId), { timeoutMs: 3000 });
    const langerAnruf = anrufAn(srv, LANGES_ZIEL);
    assert.equal(langerAnruf.status, "active");
    assert.equal(anbieter.beendetGespraech(langerAnruf.elevenlabsConversationId), false);
  });
});
