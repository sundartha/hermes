import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { makePgTestStore } from "../pg-helpers.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { createQueue } from "../../src/queue/registry.js";
import { config } from "../../src/config.js";
import { makeConfigOverrides, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;
const SECHS_STUNDEN_MS = 6 * STUNDE_MS;

function aufzeichnung() {
  const plaene = [];
  return {
    plaene,
    plane: async (name, intervallMs, lauf) => {
      plaene.push({ name, intervallMs, lauf });
    },
  };
}

async function webLogin(zeitplan, billing) {
  const { store, runner } = await makePgTestStore();
  const konfiguration = webLoginBasisKonfiguration("https://api.workos.test");
  const stumm = [mock.method(console, "log", () => {}), mock.method(console, "error", () => {})];
  try {
    await wireWebLogin({
      app: express(),
      config: { ...konfiguration, billing },
      store,
      audit: () => {},
      provision: async () => ({}),
      zeitplan,
      createPortalRunner: () => runner,
      stripeWebhookPath: "/webhooks/stripe",
      appPath: "/app",
    });
  } finally {
    for (const m of stumm) m.mock.restore();
  }
}

test("Sechs-Intervalle-1: das Web-Login meldet seine vier Sweeps und die Session-Aufbewahrung mit Takt 6 Stunden an", async () => {
  const zeitplan = aufzeichnung();
  await webLogin(zeitplan, { paymentEnabled: false });
  assert.deepEqual(zeitplan.plaene.map((p) => p.name).sort(), [
    "cancellation-mail",
    "contract-end",
    "did-release",
    "session-aufbewahrung",
  ]);
  for (const p of zeitplan.plaene) assert.equal(p.intervallMs, SECHS_STUNDEN_MS, p.name);
});

test("Sechs-Intervalle-2: mit aktiver Zahlung kommt der Stripe-Abgleich als fünfter Zeitplan dazu", async () => {
  const zeitplan = aufzeichnung();
  await webLogin(zeitplan, { paymentEnabled: true });
  assert.deepEqual(zeitplan.plaene.map((p) => p.name).sort(), [
    "cancellation-mail",
    "contract-end",
    "did-release",
    "session-aufbewahrung",
    "stripe-reconcile",
  ]);
  assert.equal(zeitplan.plaene.find((p) => p.name === "stripe-reconcile").intervallMs, SECHS_STUNDEN_MS);
});

test("Sechs-Intervalle-3: scheitert ein Sweep, nennt der Zeitplan ihn mit seinem Log-Kennzeichen", async () => {
  const zeitplan = aufzeichnung();
  await webLogin(zeitplan, { paymentEnabled: true });
  const fehler = mock.method(console, "error", () => {});
  try {
    for (const p of zeitplan.plaene.filter((e) => e.name !== "session-aufbewahrung")) p.lauf.beiFehler(new Error("kaputt"));
    assert.deepEqual(
      fehler.mock.calls.map((a) => a.arguments.join(" ")),
      ["[did-release] kaputt", "[contract-end] kaputt", "[cancellation-mail] kaputt", "[stripe-reconcile] kaputt"],
    );
  } finally {
    fehler.mock.restore();
  }
});

test("Sechs-Intervalle-9: ein scheiternder memory-Lauf mit beiFehler wird gemeldet, nicht als unbehandelte Ablehnung", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  const gemeldet = [];
  const fehler = new Error("memory-kaputt");
  await queue.plane("did-release", SECHS_STUNDEN_MS, { lauf: async () => Promise.reject(fehler), beiFehler: (f) => gemeldet.push(f) });
  t.mock.timers.tick(SECHS_STUNDEN_MS);
  await new Promise((fertig) => setImmediate(fertig));
  assert.deepEqual(gemeldet, [fehler]);
});

test("Sechs-Intervalle-10: ein scheiternder pg-boss-Lauf wird mit beiFehler gemeldet und im Takt nicht wiederholt", async (t) => {
  const clock = neueUhr();
  const { queue } = await pgBossUmgebung(t, { clock });
  const gemeldet = [];
  await queue.plane("did-release", SECHS_STUNDEN_MS, {
    lauf: async () => Promise.reject(new Error("boss-kaputt")),
    beiFehler: (f) => gemeldet.push(f.message),
  });
  await clock.setTime(clock.now() + 4 * STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  await clock.tick(30 * MINUTE_MS);
  assert.deepEqual(gemeldet, ["boss-kaputt"]);
  assert.deepEqual(await queue.ueberfaellige(), []);
});

const ZEITGRENZE_MS = 60_000;
const HTTP_OK = 200;

test(
  "Sechs-Intervalle-11: der Boot mit pgboss legt den Zeitplan webhook-zustellung im Takt des Löschtakts an",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const srv = await startServer({ env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: db.adresse } });
    t.after(() => srv.stop());
    assert.equal((await abrufMitFrist(`${srv.localUrl}/healthz`)).status, HTTP_OK);
    const verbindung = await db.verbinden();
    const { rows } = await verbindung.query("SELECT name, cron FROM pgboss.schedule WHERE name LIKE '%webhook%'");
    assert.deepEqual(rows, [{ name: "zeitplan_webhook-zustellung", cron: "*/1 * * * *" }]);
  },
);
