import assert from "node:assert/strict";
import test from "node:test";

import {
  mandantenAbruf,
  mitHermesAufPostgresMitMandanten,
  postgresVorhanden,
} from "./hermes-mit-postgres.js";
import { starteJsonAttrappe } from "./attrappen-server.js";
import { TELNYX_PG_EIGENE_NUMMER_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const HTTP_GATE_PASSIERT = 502;
const HTTP_TOO_MANY = 429;
const ZIEL_DECKEL = 3;
const EIGENE_NUMMER = "+4915112340998";
const EXTERNE_NUMMER = "+4915112340997";

const MANDANT_A = Object.freeze({
  id: "tenant_eigen_a",
  sub: "sub-eigen-a",
  e164: "+4930555000201",
  privateNumber: EIGENE_NUMMER,
});
const MANDANT_B = Object.freeze({
  id: "tenant_eigen_b",
  sub: "sub-eigen-b",
  e164: "+4930555000202",
  privateNumber: EXTERNE_NUMMER,
});

async function mitMandanten(t, lauf) {
  const abgelehnt = await starteJsonAttrappe({ detail: "abgelehnt" }, 400);
  t.after(() => abgelehnt.close());
  const env = {
    TELNYX_API_BASE: abgelehnt.url,
    TELNYX_API_KEY: TELNYX_PG_EIGENE_NUMMER_SCHLUESSEL,
    TELNYX_CONNECTION_ID: "conn_pg_eigene_nummer",
    TELNYX_ACCOUNT_SID: "acct_pg_eigene_nummer",
    ELEVENLABS_OUTBOUND_ENABLED: "false",
    PER_TARGET_CALL_CAP: String(ZIEL_DECKEL),
    OWNER_SELF_CALL_ENABLED: "true",
    OWNER_SELF_CALL_TENANT_IDS: MANDANT_A.id,
  };
  return mitHermesAufPostgresMitMandanten(t, { env, mandanten: [MANDANT_A, MANDANT_B] }, (hermes) =>
    lauf({
      a: mandantenAbruf(hermes.srv, MANDANT_A.sub),
      b: mandantenAbruf(hermes.srv, MANDANT_B.sub),
    }),
  );
}

async function dreiAnrufe(mandant, ziel) {
  for (let i = 0; i < ZIEL_DECKEL; i++) assert.equal((await mandant.rufeAn(ziel)).status, HTTP_GATE_PASSIERT);
}

async function viertenAbgelehnt(mandant, ziel) {
  await dreiAnrufe(mandant, ziel);
  const res = await mandant.rufeAn(ziel);
  assert.equal(res.status, HTTP_TOO_MANY);
  assert.equal((await res.json()).reason, "ziel_limit");
}

test("PG-EIGENE-NUMMER: gepinnte eigene Nummer 4. Anruf durch, externe Nummer 4. Anruf ziel_limit", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, async ({ a }) => {
    await dreiAnrufe(a, EIGENE_NUMMER);
    assert.equal((await a.rufeAn(EIGENE_NUMMER)).status, HTTP_GATE_PASSIERT);
    await viertenAbgelehnt(a, EXTERNE_NUMMER);
  });
});

test("PG-EIGENE-NUMMER-FREMD: dieselbe Nummer bei einem anderen Mandanten zaehlt als extern", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitMandanten(t, async ({ b }) => {
    await viertenAbgelehnt(b, EIGENE_NUMMER);
  });
});
