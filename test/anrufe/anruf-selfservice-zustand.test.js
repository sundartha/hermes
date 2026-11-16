import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import request from "../gemeinsam/testserver-anfrage.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../../src/web-auth.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const SECRET = "ss-zustand-web-secret-0123456789";
const SESSION_TTL_SECONDS = 3600;
const HTTP_OK = 200;
const HTTP_INTERNAL = 500;
const ALLE_ANRUFE = 31;
const MANDANT_A = Object.freeze({ id: "t_sub-ss-a", sub: "sub-ss-a" });
const MANDANT_B = Object.freeze({ id: "t_sub-ss-b", sub: "sub-ss-b" });
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'completed', '+4930555000401', '+4915112345678', 'Testziel', $4, 600, 'telnyx')`;
const SEGMENT_SQL = `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`;
const GESPRAECH = Object.freeze([
  ["caller", "Hallo, hier ist der Anrufer."],
  ["agent", "Guten Tag, hier ist die KI-Assistentin."],
  ["caller", "Dann passt der Donnerstag."],
]);

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

async function legeAnrufAn(db, mandant, { id, zeilen = [] }) {
  await db.query(ANRUF_SQL, [id, mandant.id, `tok_${id}`, new Date().toISOString()]);
  for (const [rolle, text] of zeilen) {
    await db.query(SEGMENT_SQL, [id, mandant.id, rolle, text, new Date().toISOString()]);
  }
}

async function setup() {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const cookies = {};
  for (const mandant of [MANDANT_A, MANDANT_B]) {
    await store.ensureTenant(mandant.id);
    await accounts.upsertOnFirstLogin({ sub: mandant.sub, email: `${mandant.sub}@kunde.de` });
    await accounts.setStatus(mandant.id, "active");
    const { id } = await sessions.create({ sub: mandant.sub, tenantId: mandant.id, ttlSeconds: SESSION_TTL_SECONDS });
    cookies[mandant.id] = cookieFor(id);
  }
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      accounts,
      provision: async () => {},
    }),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    close: () => new Promise((resolve) => server.close(resolve)),
    leseZustand: async (mandant) => {
      const res = await request("GET", `${base}/api/self-service/state`, { cookie: cookies[mandant.id] });
      const body = res.status === HTTP_OK ? JSON.parse(res.body) : {};
      return { status: res.status, text: res.body, body };
    },
  };
}

const mitAufbau = async (lauf) => {
  const aufbau = await setup();
  try {
    await lauf(aufbau);
  } finally {
    await aufbau.close();
  }
};
const idsVon = (zustand) => zustand.body.calls.map((anruf) => anruf.id);

test("SELFSERVICE-ZUSTAND-ANDERE-INSTANZ: /api/self-service/state zeigt einen Anruf, den nur die Datenbank kennt, mit Transkript, neueste zuerst", async () => {
  await mitAufbau(async ({ db, leseZustand }) => {
    await legeAnrufAn(db, MANDANT_A, { id: "call_ss_alt" });
    await legeAnrufAn(db, MANDANT_A, { id: "call_ss_neu", zeilen: GESPRAECH });
    const zustand = await leseZustand(MANDANT_A);
    assert.equal(zustand.status, HTTP_OK);
    assert.deepEqual(idsVon(zustand), ["call_ss_neu", "call_ss_alt"]);
    const [neuester] = zustand.body.calls;
    assert.deepEqual(
      neuester.transcript.map((zeile) => [zeile.role, zeile.text]),
      GESPRAECH,
    );
  });
});

test("SELFSERVICE-ZUSTAND-OHNE-LIMIT: /api/self-service/state zeigt alle 31 Anrufe, auch den aeltesten", async () => {
  await mitAufbau(async ({ db, leseZustand }) => {
    for (let i = 0; i < ALLE_ANRUFE; i++) await legeAnrufAn(db, MANDANT_A, { id: `call_ss_${String(i).padStart(2, "0")}` });
    const zustand = await leseZustand(MANDANT_A);
    const { calls } = zustand.body;
    assert.equal(calls.length, ALLE_ANRUFE);
    assert.equal(calls[0].id, "call_ss_30");
    assert.equal(idsVon(zustand).includes("call_ss_00"), true);
  });
});

test("SELFSERVICE-ZUSTAND-MANDANT: /api/self-service/state von B enthaelt keinen Anruf von A", async () => {
  await mitAufbau(async ({ db, leseZustand }) => {
    await legeAnrufAn(db, MANDANT_A, { id: "call_ss_von_a", zeilen: GESPRAECH });
    await legeAnrufAn(db, MANDANT_B, { id: "call_ss_von_b" });
    assert.deepEqual(idsVon(await leseZustand(MANDANT_B)), ["call_ss_von_b"]);
    assert.deepEqual(idsVon(await leseZustand(MANDANT_A)), ["call_ss_von_a"]);
  });
});

test("SELFSERVICE-ZUSTAND-LESEFEHLER: faellt das Lesen der Anrufe aus, antwortet /api/self-service/state mit 500 und ohne calls", async () => {
  await mitAufbau(async ({ db, leseZustand }) => {
    await legeAnrufAn(db, MANDANT_A, { id: "call_ss_eins" });
    await db.query("ALTER TABLE call RENAME TO call_weg");
    const zustand = await leseZustand(MANDANT_A);
    assert.equal(zustand.status, HTTP_INTERNAL);
    assert.equal(zustand.text.includes("call_ss_eins"), false);
  });
});
