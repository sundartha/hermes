import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbankMitRolle } from "./test-rolle.js";

const ZEITGRENZE_MS = 90_000;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const MELDEFRIST_MS = 20_000;
const STATUS_ANTWORTFRIST_MS = 2_000;
const STATUS_VERSUCHE = 10;
const STATUS_SCHLUESSEL = "s1c-portal-hoerer-statusschluessel-mindestens-32";
const HERKUNFT = "https://hermes.test";
const PORTAL_MELDUNG = "[pool:portal] Verbindung im Leerlauf verloren";
const HAUPT_MELDUNG = "[pool:haupt] Verbindung im Leerlauf verloren";
const VERLUST_ZEILE = /\[pool:\w+\] Verbindung im Leerlauf verloren/g;

function serverUmgebung(adresse) {
  return {
    STORE_BACKEND: "pg",
    DATABASE_URL: adresse,
    BOOTSTRAP_E164: "+15005550006",
    BOOTSTRAP_PROVIDER: "telnyx",
    HERMES_DEPLOY_TOKEN: "s1c-portal-hoerer-deploy-token-mindestens-32",
    HERMES_STATUS_TOKEN: STATUS_SCHLUESSEL,
    SESSION_SECRET: "s1c-portal-hoerer-sitzungsgeheimnis",
    OIDC_CLIENT_ID: "s1c-client",
    OIDC_CLIENT_SECRET: "s1c-geheimnis",
  };
}

function einwilligung(server) {
  return abrufMitFrist(`${server.localUrl}/api/cookie-consent`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Origin: HERKUNFT },
    body: JSON.stringify({ id: randomUUID(), version: 1, statistics: false, marketing: false }),
  });
}

async function statusNachFertigemFlush(server) {
  let status;
  for (let versuch = 0; versuch < STATUS_VERSUCHE && status !== HTTP_OK; versuch++) {
    const antwort = await abrufMitFrist(
      `${server.localUrl}/intern/status`,
      { headers: { Authorization: `Bearer ${STATUS_SCHLUESSEL}` } },
      { wartezeitMs: STATUS_ANTWORTFRIST_MS },
    );
    status = antwort.status;
  }
  return status;
}

async function beidePoolsHaltenLeerlaufVerbindung(server) {
  assert.equal(await statusNachFertigemFlush(server), HTTP_OK);
  assert.equal((await einwilligung(server)).status, HTTP_NO_CONTENT);
}

function gemeldeteVerluste(server) {
  return server.stdout.match(VERLUST_ZEILE)?.length ?? 0;
}

async function bisVerlusteGemeldet(server, beendet) {
  const frist = AbortSignal.timeout(MELDEFRIST_MS);
  while (!frist.aborted && server.child.exitCode === null && gemeldeteVerluste(server) < beendet) {
    await once(server.child.stderr, "data", { signal: frist }).catch(() => {});
  }
}

test(
  "Pool-Schutz: ein Verbindungsfehler im Leerlauf des Portal-Pools wird protokolliert, und der Server antwortet weiter",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbankMitRolle(t);
    if (!db) return;
    const server = await startServer({ env: serverUmgebung(db.adresse) });
    try {
      await beidePoolsHaltenLeerlaufVerbindung(server);
      const { rows: beendet } = await db.leerlaufVerbindungenBeenden();
      await bisVerlusteGemeldet(server, beendet.length);
      assert.equal(server.child.exitCode, null, server.stdout);
      assert.ok(server.stdout.includes(PORTAL_MELDUNG), server.stdout);
      assert.ok(server.stdout.includes(HAUPT_MELDUNG), server.stdout);
      const gesund = await abrufMitFrist(`${server.localUrl}/healthz`);
      assert.equal(gesund.status, HTTP_OK);
      assert.equal((await einwilligung(server)).status, HTTP_NO_CONTENT);
    } finally {
      await server.stop();
    }
  },
);
