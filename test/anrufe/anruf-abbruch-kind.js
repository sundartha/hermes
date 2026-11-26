import assert from "node:assert/strict";
import express from "express";
import pg from "pg";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { vorspannDiAttrappe } from "../gemeinsam/vorspann-fahrzeug.js";

const MAX_DAUER_S = 30;
const NUR_EIN_ANRUF = 1;
const HTTP_OK = 200;

async function abbruchRoute({ speicher, mandant }) {
  const { makeCallRoutes } = await import("../../src/routes/api-calls.ts");
  const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...vorspannDiAttrappe(),
      store: speicher,
      leitungsplaetze: speicher.leitungsplaetze,
      config: withConfigNamespaces({ elevenLabsOutbound: { enabled: true }, publicUrl: "https://hermes.test" }),
      audit: () => {},
      outboundGates: [],
      voiceControl: () => ({}),
      terminateAndBillCall: async ({ persistEnd }) => {
        await persistEnd();
      },
      hangUpAction: () => null,
      elevenLabsHangUpAction: () => async () => {},
      endActiveCall: async () => {},
      billThunk: () => async () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => mandant, requireTenant: () => mandant, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  return app;
}

async function brichAb(app, callId) {
  const server = await new Promise((fertig) => {
    const srv = app.listen(0, "127.0.0.1", () => fertig(srv));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls/${callId}/cancel`, { method: "POST" });
    assert.equal(antwort.status, HTTP_OK);
    return await antwort.json();
  } finally {
    server.closeAllConnections();
    await new Promise((fertig) => server.close(fertig));
  }
}


async function spieleAbbruchAb(adresse) {
  Object.assign(process.env, pgStartUmgebung(adresse));
  const speicher = await import("../../src/store.js");
  const { BOOTSTRAP_TENANT_ID: mandant } = await import("../../src/begriffe/mandant.ts");
  await speicher.oeffneSpeicher();
  const pool = new pg.Pool({ connectionString: adresse });
  const { ANBIETER, leitungsplaetze } = speicher;
  const call = speicher.createCall({ direction: "outbound", from: "+4930555000310", to: "+4915112349944", goal: "Test", tenantId: mandant, provider: "telnyx" });
  await speicher.persistCall(call.id);
  const anfrage = { tenantId: mandant, weg: ANBIETER.ELEVENLABS, hoechstzahlKunde: NUR_EIN_ANRUF };
  const belegt = await leitungsplaetze.belegenAusgehend({ ...anfrage, callId: call.id, maxDauerS: MAX_DAUER_S });
  const vorAbbruch = await leitungsplaetze.pruefenAusgehend(anfrage);
  const koerper = await brichAb(await abbruchRoute({ speicher, mandant }), call.id);
  const nachAbbruch = await leitungsplaetze.pruefenAusgehend(anfrage);
  await pool.query("UPDATE leitungsplatz SET ablauf_um = now() - interval '1 second' WHERE call_id = $1", [call.id]);
  const nachAblauf = await leitungsplaetze.pruefenAusgehend(anfrage);
  return { belegt: belegt.entscheidung, vorAbbruch, koerper, bewacht: speicher.anrufHierBewacht(call.id), nachAbbruch, nachAblauf };
}

const ergebnis = await spieleAbbruchAb(process.env.ABBRUCH_KIND_DATENBANK);
console.log(JSON.stringify(ergebnis));
process.exit(0);
