import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { planProfileFor } from "../../src/plans.ts";
import {
  readToolResult,
  seedState,
  startIdp,
  startServer,
  toolCall,
  waitForLog,
} from "../helpers.js";
import { abrufMitFrist, mitAntwortfrist } from "./antwortfrist.mjs";
import { haengendeAnfrage } from "./haengende-anfrage.mjs";

const STATUS_OK = 200;
const STATUS_NICHT_VERFUEGBAR = 503;
const GESAMTFRIST_MS = 10000;
const FREMDE_ADRESSE = { "x-forwarded-for": "203.0.113.7" };
const LOG_SIGNAL = /\[shutdown\] Signal SIGTERM/;
const TENANT = "t_stopp";
const SUBJEKT = "sub-stopp";
const EIGENE_NUMMER = "+4915110000081";
const ZIEL_NUMMER = "+4915112340097";

const seed = () =>
  seedState({
    tenants: [
      { id: TENANT, idpSubject: SUBJEKT, status: "active", ownerName: "Stopp Kunde", kycLevel: "card" },
    ],
    profiles: { [TENANT]: planProfileFor("business") },
    numbers: [
      {
        id: "num_stopp",
        e164: EIGENE_NUMMER,
        tenantId: TENANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });

function warteAufEnde(srv) {
  return new Promise((fertig) => srv.child.once("close", fertig));
}

async function startOhneAnmeldung(t) {
  const srv = await startServer({ env: { SHUTDOWN_DRAIN_TIMEOUT_MS: String(GESAMTFRIST_MS) } });
  t.after(() => {
    if (srv.child.exitCode === null) srv.child.kill("SIGKILL");
  });
  return srv;
}

async function stoppeMitOffenerAnfrage(srv, pruefung) {
  const offen = haengendeAnfrage(srv);
  await abrufMitFrist(`${srv.localUrl}/healthz`);
  const ende = warteAufEnde(srv);
  srv.child.kill("SIGTERM");
  await waitForLog(srv, LOG_SIGNAL);
  try {
    await pruefung();
  } finally {
    offen.vervollstaendige();
  }
  await offen.ausgang;
  return ende;
}

test("SG-26 Anfrage mit Weiterleitungs-Kopfzeile bekommt nach SIGTERM 503 mit Retry-After und Connection: close", async (t) => {
  const srv = await startOhneAnmeldung(t);
  let antwort;

  const exitCode = await stoppeMitOffenerAnfrage(srv, async () => {
    antwort = await abrufMitFrist(`${srv.localUrl}/healthz`, { headers: FREMDE_ADRESSE });
  });

  assert.equal(antwort.status, STATUS_NICHT_VERFUEGBAR);
  assert.equal(antwort.headers.get("retry-after"), "5");
  assert.equal(antwort.headers.get("connection"), "close");
  assert.equal(await antwort.text(), "");
  assert.equal(exitCode, 0);
});

test("nach SIGTERM bekommt POST /mcp von aussen 503 und keine Anmeldeaufforderung", async (t) => {
  const srv = await startOhneAnmeldung(t);
  let antwort;

  await stoppeMitOffenerAnfrage(srv, async () => {
    antwort = await abrufMitFrist(`${srv.localUrl}/mcp`, {
      method: "POST",
      headers: { ...FREMDE_ADRESSE, "content-type": "application/json" },
      body: JSON.stringify(toolCall("place_call", {})),
    });
  });

  assert.equal(antwort.status, STATUS_NICHT_VERFUEGBAR);
  assert.equal(antwort.headers.get("www-authenticate"), null);
});

test("vor und nach SIGTERM beantwortet GET /healthz ueber Loopback ohne Weiterleitungs-Kopfzeile mit 200", async (t) => {
  const srv = await startOhneAnmeldung(t);
  const vorher = await abrufMitFrist(`${srv.localUrl}/healthz`, { headers: FREMDE_ADRESSE });
  let nachher;

  await stoppeMitOffenerAnfrage(srv, async () => {
    nachher = await abrufMitFrist(`${srv.localUrl}/healthz`);
  });

  assert.equal(vorher.status, STATUS_OK, "vor dem Signal wirkt die Weiche nicht");
  assert.equal(nachher.status, STATUS_OK);
});

function sendeAufrufMitSpaeteremRumpf(srv, token, rumpf) {
  const anfrage = mitAntwortfrist(
    http.request(`${srv.localUrl}/mcp`, {
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-length": String(Buffer.byteLength(rumpf)),
      },
    }),
  );
  const antwort = new Promise((fertig, scheitert) => {
    anfrage.on("error", scheitert);
    anfrage.on("response", (res) => {
      const stuecke = [];
      res.on("data", (stueck) => stuecke.push(stueck));
      res.on("end", () => fertig(Buffer.concat(stuecke).toString("utf8")));
    });
  });
  anfrage.flushHeaders();
  return { antwort, sendeRumpf: () => anfrage.end(rumpf) };
}

test("ein vor SIGTERM begonnener place_call wird nach dem Signal zu Ende gefuehrt und der Prozess endet mit Exit 0", async (t) => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      FAKE_ORIGINATE: "true",
      SHUTDOWN_DRAIN_TIMEOUT_MS: String(GESAMTFRIST_MS),
    },
    seed: seed(),
  });
  t.after(async () => {
    if (srv.child.exitCode === null) srv.child.kill("SIGKILL");
    await idp.close();
  });
  const rumpf = JSON.stringify(toolCall("place_call", { to: ZIEL_NUMMER, objective: "Termin vereinbaren" }));
  const aufruf = sendeAufrufMitSpaeteremRumpf(srv, await idp.sign({ sub: SUBJEKT }), rumpf);
  await abrufMitFrist(`${srv.localUrl}/healthz`);
  const ende = warteAufEnde(srv);

  srv.child.kill("SIGTERM");
  await waitForLog(srv, LOG_SIGNAL);
  aufruf.sendeRumpf();
  const ergebnis = await readToolResult(new Response(await aufruf.antwort));
  const exitCode = await ende;

  assert.notEqual(ergebnis.isError, true, JSON.stringify(ergebnis));
  assert.equal(ergebnis.structuredContent.status, "dialing");
  assert.match(ergebnis.structuredContent.call_id, /^call_/);
  assert.equal(exitCode, 0);
});
