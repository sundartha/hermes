import { before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { schalteNebenkanaeleAb, startServer, seedState, seedCall, tempDataDir } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannDiAttrappe, vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const MANDANT = "kunde";
const ENV = {
  ...vorspannMandantenUmgebung([MANDANT]),
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
};

const KOPF = { "x-internal-identity": "alice", "x-internal-tenant": MANDANT };

const seedMit = (profil) =>
  seedState({
    calls: [seedCall({ id: "call_h1", tenantId: MANDANT, status: "completed", endedAt: new Date().toISOString() })],
    profiles: { [MANDANT]: profil },
  });

async function mitServer(seed, run) {
  const srv = await startServer({ env: ENV, seed });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const antworten = (srv) =>
  abrufMitFrist(`${srv.localUrl}/api/calls/call_h1/consult/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...KOPF },
    body: JSON.stringify({ event_id: "c0", answers: ["a"], status: "working" }),
  });

test("2940-H1-1: ohne Rueckfrage-Freigabe antwortet die Abfrage mit 404 not found", async () => {
  await mitServer(seedMit({ allowConsult: false }), async (srv) => {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls/call_h1/consult`, { headers: KOPF });
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "not found" });
  });
});

test("2940-H1-2: mit Rueckfrage-Freigabe liefert die Abfrage das Ende-Ereignis mit 200", async () => {
  await mitServer(seedMit({ allowConsult: true }), async (srv) => {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls/call_h1/consult`, { headers: KOPF });
    assert.equal(res.status, HTTP_OK);
    const ereignis = await res.json();
    assert.equal(ereignis.event, "done");
  });
});

test("2940-H1-3: ohne Rueckfrage-Freigabe weist die Antwort-Route mit 403 ab", async () => {
  await mitServer(seedMit({ allowConsult: false }), async (srv) => {
    const res = await antworten(srv);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), {
      error: "Consult-Kanal ist fuer diesen Tenant nicht freigegeben.",
    });
  });
});

const TENANT = "T";
let makeCallRoutes;
let speicher;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  const { config } = await import("../../src/config.ts");
  config.tenancy.consultEnabled = true;
  config.tenancy.assistantContextEnabled = true;
  speicher = await import("../../src/store.js");
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

async function mitProfilLeser(resolveProfile, run) {
  const call = seedCall({ id: "call_h1", tenantId: TENANT, status: "active" });
  const store = {
    ...speicher,
    getCall: () => call,
    resolveProfile,
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...vorspannDiAttrappe(),
      store,
      leitungsplaetze: speicher.makeLeitungsplaetze(),
      config: withConfigNamespaces({}),
      audit: () => {},
      outboundGates: [],
      callQuotaDenial: async () => null,
      voiceControl: () => ({}),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => TENANT, requireTenant: () => TENANT, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const original = console.error;
  console.error = () => {};
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    console.error = original;
    await new Promise((resolve) => server.close(resolve));
  }
}

const mitKaputtemProfil = (run) =>
  mitProfilLeser(() => {
    throw new Error("profil-kaputt");
  }, run);

test("2940-H1-4: wirft das Profil-Lesen, antworten beide Routen mit 500 statt gar nicht", async () => {
  await mitKaputtemProfil(async (basis) => {
    const abfrage = await abrufMitFrist(`${basis}/api/calls/call_h1/consult`);
    assert.equal(abfrage.status, HTTP_SERVER_ERROR);
    const antwort = await abrufMitFrist(`${basis}/api/calls/call_h1/consult/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: "c0", answers: ["a"] }),
    });
    assert.equal(antwort.status, HTTP_SERVER_ERROR);
  });
});

test("2940-H1-5: liefert das Profil-Lesen sein Ergebnis erst spaeter, gilt die Freigabe darin und die Abfrage antwortet mit 200", async () => {
  await mitProfilLeser(async () => ({ allowConsult: true }), async (basis) => {
    const res = await abrufMitFrist(`${basis}/api/calls/call_h1/consult`);
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(await res.json(), {});
  });
});
