import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbankMitRolle } from "./test-rolle.js";

const ZEITGRENZE_MS = 90_000;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const WARTESCHRITT_MS = 50;
const WARTESCHRITTE = 100;
const HERKUNFT = "https://hermes.test";
const PORTAL_MELDUNG = "[pool:portal] Verbindung im Leerlauf verloren";
const HAUPT_MELDUNG = "[pool:haupt] Verbindung im Leerlauf verloren";

function serverUmgebung(adresse) {
  return {
    STORE_BACKEND: "pg",
    DATABASE_URL: adresse,
    BOOTSTRAP_E164: "+15005550006",
    BOOTSTRAP_PROVIDER: "telnyx",
    HERMES_DEPLOY_TOKEN: "s1c-portal-hoerer-deploy-token-mindestens-32",
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

async function wartenBisGemeldet(server, meldungen) {
  for (let schritt = 0; schritt < WARTESCHRITTE; schritt++) {
    const alle = meldungen.every((meldung) => server.stdout.includes(meldung));
    if (alle || server.child.exitCode !== null) return;
    await echtWarten(WARTESCHRITT_MS);
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
      assert.equal((await einwilligung(server)).status, HTTP_NO_CONTENT);
      await db.verbindungenBeenden();
      await wartenBisGemeldet(server, [PORTAL_MELDUNG, HAUPT_MELDUNG]);
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
