import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import express from "express";

import { makeReadRoutes } from "../../src/routes/api-read.ts";
import * as speicher from "../../src/store.js";
import { registerTools } from "../../src/mcp-tools.js";
import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const KUNDEN = 4;
const PLAETZE = 4;
const WAHL_PFAD = "/v2/calls";
const kundeVon = (index) => `t_queued_${index}`;
const absenderVon = (index) => `+1202555${String(3100 + index).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(6100 + nummer).padStart(4, "0")}`;

function seedKunden() {
  const indizes = Array.from({ length: KUNDEN }, (_, index) => index);
  return seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_queued_${index}`,
      e164: absenderVon(index),
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_queued_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

const kopf = (index) => ({ "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) });

async function rufeAn(srv, index, ziel) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: kopf(index),
    body: JSON.stringify({ to: ziel, objective: "Tisch fuer zwei reservieren (queued sichtbar)" }),
  });
  assert.equal(res.status, HTTP_OK);
  return res.json();
}

const lies = async ({ srv, index, pfad, methode = "GET" }) => {
  const res = await abrufMitFrist(`${srv.localUrl}${pfad}`, { headers: kopf(index), method: methode });
  assert.equal(res.status, HTTP_OK);
  return res.json();
};

async function mitVollerPlattform(lauf) {
  const attrappe = await starteAttrappe();
  const kunden = Array.from({ length: KUNDEN }, (_, index) => kundeVon(index));
  const env = {
    ...vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "queued" }),
    ...vorspannMandantenUmgebung(kunden),
  };
  let srv = null;
  try {
    srv = await startServer({ env, seed: seedKunden() });
    const laufende = [];
    for (let nummer = 0; nummer < PLAETZE; nummer += 1) laufende.push((await rufeAn(srv, nummer, zielVon(nummer))).callId);
    const wartend = (await rufeAn(srv, KUNDEN - 1, zielVon(900))).callId;
    await waitForStoreState(srv, (s) => s.calls.length >= PLAETZE + 1);
    const gewaehlt = () => attrappe.pfade.filter((pfad) => pfad === WAHL_PFAD).length;
    await lauf({ srv, laufende, wartend, gewaehlt });
  } finally {
    await srv?.stop();
    await attrappe.close();
  }
}

test("queued: ein wartender Anruf steht in der Anrufabfrage und in der Anrufliste als queued, ein laufender nicht", async () => {
  await mitVollerPlattform(async ({ srv, laufende, wartend }) => {
    const einzeln = await lies({ srv, index: KUNDEN - 1, pfad: `/api/calls/${wartend}` });
    assert.equal(einzeln.status, "active");
    assert.equal(einzeln.queued, true);
    const laufend = await lies({ srv, index: 0, pfad: `/api/calls/${laufende[0]}` });
    assert.equal(laufend.queued, undefined);
    const liste = (await lies({ srv, index: KUNDEN - 1, pfad: "/api/state" })).calls;
    assert.equal(liste.find((eintrag) => eintrag.id === wartend).queued, true);
    assert.equal(liste.find((eintrag) => eintrag.id === laufende[KUNDEN - 1]).queued, undefined);
  });
});

test("queued: cancel_call eines wartenden Anrufs beendet ihn als cancelled, ohne Wahl, und er steht danach nicht mehr als queued da", async () => {
  await mitVollerPlattform(async ({ srv, wartend, gewaehlt }) => {
    assert.equal(gewaehlt(), PLAETZE);
    const antwort = await lies({ srv, index: KUNDEN - 1, pfad: `/api/calls/${wartend}/cancel`, methode: "POST" });
    assert.equal(antwort.status, "cancelled");
    const danach = await lies({ srv, index: KUNDEN - 1, pfad: `/api/calls/${wartend}` });
    assert.equal(danach.status, "cancelled");
    assert.equal(danach.queued, undefined);
    assert.equal(danach.callControlId ?? null, null);
    assert.equal(gewaehlt(), PLAETZE);
  });
});

async function mitGateway(antworten, lauf) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(antworten[req.url]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  const handlers = new Map();
  registerTools(
    { registerTool: (name, _c, handler) => handlers.set(name, handler), registerResource() {} },
    { identity: null, scopedTenant: "tenant_queued", consultAllowed: true, language: "de" },
  );
  try {
    return await lauf(handlers);
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await new Promise((resolve) => server.close(resolve));
  }
}

const EINTRAG = { id: "call_q", direction: "outbound", to: "+12025550123", startedAt: "2026-11-18T10:00:00.000Z", transcript: [] };

const FAELLE = [
  { name: "wartend", zusatz: { status: "active", queued: true }, erwartet: "queued" },
  { name: "waehlend", zusatz: { status: "active" }, erwartet: "dialing" },
  { name: "angenommen", zusatz: { status: "active", answeredAt: "2026-11-18T10:00:05.000Z" }, erwartet: "in_progress" },
  { name: "angenommen und noch wartend markiert", zusatz: { status: "active", queued: true, answeredAt: "2026-11-18T10:00:05.000Z" }, erwartet: "in_progress" },
  { name: "beendet", zusatz: { status: "completed", queued: true }, erwartet: "completed" },
];

for (const { name, zusatz, erwartet } of FAELLE) {
  test(`queued: get_call_status und list_calls melden einen ${name}en Anruf als ${erwartet}`, async () => {
    const antworten = { "/api/calls/call_q": { ...EINTRAG, ...zusatz }, "/api/state": { calls: [{ ...EINTRAG, ...zusatz }] } };
    await mitGateway(antworten, async (handlers) => {
      const status = await handlers.get("get_call_status")({ call_id: "call_q" });
      assert.equal(status.structuredContent.status, erwartet);
      const [eintrag] = (await handlers.get("list_calls")({})).structuredContent.calls;
      assert.equal(eintrag.status, erwartet);
    });
  });
}

const MANDANT = "t_queued_leitung";
const WARTENDER_ANRUF = {
  id: "call_wartet",
  tenantId: MANDANT,
  direction: "outbound",
  status: "active",
  answeredAt: null,
  callControlId: null,
};

async function liesEinzeln({ anruf, leitungsplaetze }) {
  const tenant = { requestTenant: () => MANDANT, requireTenant: () => MANDANT, tenantOwnsCall: () => true };
  const store = { getCall: () => anruf, leseCallUngebunden: async () => anruf, leitungsplaetze };
  const app = express();
  app.use(makeReadRoutes({ store, config: {}, audit: () => {}, tenant }));
  const server = await new Promise((listening) => {
    const http = app.listen(0, "127.0.0.1", () => listening(http));
  });
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls/${anruf.id}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

const mitPlaetzen = (belegt) => ({ belegteAnrufe: async () => new Set(belegt) });

const ABFRAGE_FAELLE = [
  { name: "ohne Platz", leitungsplaetze: mitPlaetzen([]), erwartet: true },
  { name: "mit Platz", leitungsplaetze: mitPlaetzen([WARTENDER_ANRUF.id]), erwartet: undefined },
  { name: "eingehend", anruf: { direction: "inbound" }, leitungsplaetze: mitPlaetzen([]), erwartet: undefined },
  { name: "beendet", anruf: { status: "completed" }, leitungsplaetze: mitPlaetzen([]), erwartet: undefined },
  { name: "angenommen", anruf: { answeredAt: "2026-11-18T10:00:05.000Z" }, leitungsplaetze: mitPlaetzen([]), erwartet: undefined },
  { name: "mit Anbieterkennung", anruf: { callControlId: "cc_1" }, leitungsplaetze: mitPlaetzen([]), erwartet: undefined },
  { name: "ohne Platztabelle", leitungsplaetze: undefined, erwartet: undefined },
  {
    name: "bei unlesbarer Platztabelle",
    leitungsplaetze: {
      belegteAnrufe: async () => {
        throw new Error("Datenbank weg");
      },
    },
    erwartet: undefined,
  },
];

for (const { name, anruf = {}, leitungsplaetze, erwartet } of ABFRAGE_FAELLE) {
  test(`queued: ein Anruf ${name} steht ${erwartet ? "als queued" : "nicht als queued"} in der Anrufabfrage`, async () => {
    const { status, body } = await liesEinzeln({ anruf: { ...WARTENDER_ANRUF, ...anruf }, leitungsplaetze });
    assert.equal(status, HTTP_OK);
    assert.equal(body.queued, erwartet);
    assert.equal(body.id, WARTENDER_ANRUF.id);
  });
}

test("queued: die Platztabelle wird nur nach Anrufen gefragt, die warten koennen", async () => {
  const gefragt = [];
  const leitungsplaetze = {
    belegteAnrufe: async (kennungen) => {
      gefragt.push(kennungen);
      return new Set();
    },
  };
  await liesEinzeln({ anruf: { ...WARTENDER_ANRUF, status: "completed" }, leitungsplaetze });
  assert.deepEqual(gefragt, []);
  await liesEinzeln({ anruf: WARTENDER_ANRUF, leitungsplaetze });
  assert.deepEqual(gefragt, [[WARTENDER_ANRUF.id]]);
});

test("queued: belegteAnrufe nennt nur Anrufe mit gueltigem Platz, im Speicher und in Postgres", async () => {
  const { db, runner } = await makePgTestStore();
  const anfrage = (callId) => ({ callId, tenantId: MANDANT, weg: "elevenlabs", maxDauerS: 60, hoechstzahlKunde: 2 });
  for (const plaetze of [speicher.makeLeitungsplaetze(), speicher.makePostgresLeitungsplaetze(runner)]) {
    await plaetze.belegenAusgehend(anfrage("c_mit_platz"));
    await plaetze.belegenAusgehend(anfrage("c_frei_gegeben"));
    await plaetze.freigeben("c_frei_gegeben");
    const belegt = await plaetze.belegteAnrufe(["c_mit_platz", "c_frei_gegeben", "c_unbekannt"]);
    assert.deepEqual([...belegt], ["c_mit_platz"]);
    assert.deepEqual([...(await plaetze.belegteAnrufe([]))], []);
  }
  await db.query("UPDATE leitungsplatz SET ablauf_um = now() - interval '1 minute'");
  const abgelaufen = await speicher.makePostgresLeitungsplaetze(runner).belegteAnrufe(["c_mit_platz"]);
  assert.deepEqual([...abgelaufen], []);
});
