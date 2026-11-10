import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_GATE_PASSIERT = 500;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const EIGENE_NUMMER = "+491713920012";
const ALTE_NUMMER = "+491713920099";
const EXTERNE_NUMMER = "+491729999001";
const ZIEL_DECKEL = 3;

const BASIS_ENV = {
  ALLOWED_COUNTRY_CODES: "+49",
  PER_TARGET_CALL_CAP: String(ZIEL_DECKEL),
};

const gepinnt = { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID };
const nichtGepinnt = { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: "" };
const schalterAus = { OWNER_SELF_CALL_ENABLED: "false", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID };

const seedMit = (privateNumber) =>
  seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: "Jonas",
        ownerName: "Jonas Beispiel",
        privateNumber,
      },
    ],
  });

async function mitServer({ env, privateNumber = EIGENE_NUMMER }, lauf) {
  const srv = await startServer({ env: { ...BASIS_ENV, ...env }, seed: seedMit(privateNumber) });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

let zaehler = 0;
const rufeAn = (srv, to) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: `Auftrag ${++zaehler}` }),
  });

async function ruftBisDeckelAn(srv, to) {
  for (let i = 0; i < ZIEL_DECKEL; i++) assert.equal((await rufeAn(srv, to)).status, HTTP_GATE_PASSIERT);
}

async function viertenAnrufAbgelehnt(srv, to, grund) {
  await ruftBisDeckelAn(srv, to);
  const res = await rufeAn(srv, to);
  assert.equal(res.status, HTTP_TOO_MANY);
  assert.equal((await res.json()).reason, grund);
}

test("EN-ZL-1: gepinnte eigene Nummer, der 4. und 5. Anruf in 24 h gehen durch", async () => {
  await mitServer({ env: gepinnt }, async (srv) => {
    await ruftBisDeckelAn(srv, EIGENE_NUMMER);
    assert.equal((await rufeAn(srv, EIGENE_NUMMER)).status, HTTP_GATE_PASSIERT);
    assert.equal((await rufeAn(srv, EIGENE_NUMMER)).status, HTTP_GATE_PASSIERT);
  });
});

test("EN-ZL-2: Tenant nicht gepinnt, der 4. Anruf an die eigene Nummer endet mit ziel_limit", async () => {
  await mitServer({ env: nichtGepinnt }, (srv) => viertenAnrufAbgelehnt(srv, EIGENE_NUMMER, "ziel_limit"));
});

test("EN-ZL-2b: Schalter aus, der 4. Anruf an die eigene Nummer endet mit ziel_limit", async () => {
  await mitServer({ env: schalterAus }, (srv) => viertenAnrufAbgelehnt(srv, EIGENE_NUMMER, "ziel_limit"));
});

test("SG-09 externe Nummer nach 3 Anrufen in 24 h bleibt blockiert (ziel_limit)", async () => {
  await mitServer({ env: gepinnt }, (srv) => viertenAnrufAbgelehnt(srv, EXTERNE_NUMMER, "ziel_limit"));
});

test("EN-ZL-5: geaenderte eigene Nummer, die alte Nummer zaehlt wieder als extern", async () => {
  await mitServer({ env: gepinnt, privateNumber: EIGENE_NUMMER }, (srv) =>
    viertenAnrufAbgelehnt(srv, ALTE_NUMMER, "ziel_limit"),
  );
});

test("EN-ZL-5b: geloeschte eigene Nummer, der 4. Anruf an die alte Nummer endet mit ziel_limit", async () => {
  await mitServer({ env: gepinnt, privateNumber: null }, (srv) =>
    viertenAnrufAbgelehnt(srv, EIGENE_NUMMER, "ziel_limit"),
  );
});

test("EN-ZL-6: Stundenlimit greift fuer die gepinnte eigene Nummer weiter", async () => {
  await mitServer({ env: { ...gepinnt, MAX_CALLS_PER_HOUR: "1" } }, async (srv) => {
    assert.equal((await rufeAn(srv, EIGENE_NUMMER)).status, HTTP_GATE_PASSIERT);
    const res = await rufeAn(srv, EIGENE_NUMMER);
    assert.equal(res.status, HTTP_TOO_MANY);
    assert.equal((await res.json()).reason, "stundenlimit");
  });
});

test("EN-ZL-6b: Not-Aus sperrt die gepinnte eigene Nummer weiter", async () => {
  await mitServer({ env: { ...gepinnt, OUTBOUND_FROZEN: "true" } }, async (srv) => {
    const res = await rufeAn(srv, EIGENE_NUMMER);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal((await res.json()).reason, "frozen");
  });
});
