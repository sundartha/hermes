import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { neuePglite } from "../pglite-helfer.js";
import { applySchema } from "../../src/db/migrate.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { scheduleSessionRetention } from "../../src/wiring/session-aufbewahrung.js";
import { planeLoeschtakt } from "../../src/store/webhook-zustellung.js";
import { createQueue } from "../../src/queue/registry.js";
import { config } from "../../src/config.js";
import { makeConfigOverrides } from "../helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;
const SECHS_STUNDEN_MS = 6 * STUNDE_MS;

const fakeStore = {
  ensureTenant() {},
  bindSubToTenant() {},
  withStoreLock: async (fn) => fn(),
  load: () => ({}),
  save() {},
};

function aufzeichnung() {
  const plaene = [];
  return {
    plaene,
    plane: async (name, intervallMs, lauf, optionen) => {
      plaene.push({ name, intervallMs, lauf, optionen });
    },
  };
}

async function webLogin(zeitplan, billing) {
  const db = await neuePglite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p) }) };
  const konfiguration = webLoginBasisKonfiguration("https://api.workos.test");
  const stumm = [mock.method(console, "log", () => {}), mock.method(console, "error", () => {})];
  try {
    await wireWebLogin({
      app: express(),
      config: { ...konfiguration, billing },
      store: fakeStore,
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
    for (const p of zeitplan.plaene.filter((e) => e.name !== "session-aufbewahrung")) p.optionen.beiFehler(new Error("kaputt"));
    assert.deepEqual(
      fehler.mock.calls.map((a) => a.arguments.join(" ")),
      ["[did-release] kaputt", "[contract-end] kaputt", "[cancellation-mail] kaputt", "[stripe-reconcile] kaputt"],
    );
  } finally {
    fehler.mock.restore();
  }
});

function zaehlenderRunner(zaehler) {
  const client = {
    query: async (sql) => {
      if (/^\s*DELETE/.test(sql)) zaehler.loeschungen++;
      return { rows: [], rowCount: 0 };
    },
  };
  return { withClient: (fn) => fn(client) };
}

async function zweiInstanzen(t, planen, beginnMs = null) {
  const clock = neueUhr();
  if (beginnMs !== null) await clock.setTime(beginnMs);
  const { queue, weitereQueue } = await pgBossUmgebung(t, { clock });
  const zaehler = { loeschungen: 0 };
  const stumm = mock.method(console, "log", () => {});
  try {
    await planen(queue, zaehlenderRunner(zaehler));
    await planen(weitereQueue(), zaehlenderRunner(zaehler));
  } finally {
    stumm.mock.restore();
  }
  return { clock, zaehler };
}

test("Sechs-Intervalle-4: bei zwei Instanzen läuft die Session-Aufbewahrung je Takt genau einmal", async (t) => {
  const { clock, zaehler } = await zweiInstanzen(t, (queue, runner) => scheduleSessionRetention(runner, queue));
  assert.equal(zaehler.loeschungen, 2);
  await clock.setTime(clock.now() + 4 * STUNDE_MS - 2 * MINUTE_MS);
  await clock.tick(MINUTE_MS);
  assert.equal(zaehler.loeschungen, 2);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(zaehler.loeschungen, 3);
});

test("Sechs-Intervalle-5: bei zwei Instanzen läuft die Webhook-Löschung je Takt genau einmal", async (t) => {
  const { clock, zaehler } = await zweiInstanzen(
    t,
    (queue, runner) => planeLoeschtakt({ runner, taktMs: 15 * MINUTE_MS, mitAblage: true, zeitplan: queue }),
    Date.UTC(2026, 10, 1, 8, 5),
  );
  assert.equal(zaehler.loeschungen, 2);
  await clock.tick(9 * MINUTE_MS);
  assert.equal(zaehler.loeschungen, 2);
  await clock.tick(2 * MINUTE_MS);
  assert.equal(zaehler.loeschungen, 3);
});

test("Sechs-Intervalle-7: mit memory läuft die Session-Aufbewahrung wie bisher beim Start und alle 6 Stunden im Prozess", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  const zaehler = { loeschungen: 0 };
  await scheduleSessionRetention(zaehlenderRunner(zaehler), queue);
  assert.equal(zaehler.loeschungen, 1);
  t.mock.timers.tick(SECHS_STUNDEN_MS - 1);
  assert.equal(zaehler.loeschungen, 1);
  t.mock.timers.tick(1);
  assert.equal(zaehler.loeschungen, 2);
});

test("Sechs-Intervalle-8: die Webhook-Löschung meldet den Takt unter dem Namen webhook-zustellung, scheitert sie, loggt sie den Fehlercode", async () => {
  const zeitplan = aufzeichnung();
  const log = mock.method(console, "log", () => {});
  const fehler = mock.method(console, "error", () => {});
  try {
    await planeLoeschtakt({ runner: zaehlenderRunner({}), taktMs: 1234, mitAblage: false, zeitplan });
    assert.equal(zeitplan.plaene.length, 1);
    assert.equal(zeitplan.plaene[0].name, "webhook-zustellung");
    assert.equal(zeitplan.plaene[0].intervallMs, 1234);
    zeitplan.plaene[0].optionen.beiFehler({ code: "57014" });
    assert.deepEqual(fehler.mock.calls.map((a) => a.arguments[0]), ["[webhook-zustellung] loeschen_fehlgeschlagen code=57014"]);
  } finally {
    log.mock.restore();
    fehler.mock.restore();
  }
});

test("Sechs-Intervalle-9: ein scheiternder memory-Lauf mit beiFehler wird gemeldet, nicht als unbehandelte Ablehnung", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  const gemeldet = [];
  const fehler = new Error("memory-kaputt");
  await queue.plane("did-release", SECHS_STUNDEN_MS, async () => Promise.reject(fehler), { beiFehler: (f) => gemeldet.push(f) });
  t.mock.timers.tick(SECHS_STUNDEN_MS);
  await new Promise((fertig) => setImmediate(fertig));
  assert.deepEqual(gemeldet, [fehler]);
});

test("Sechs-Intervalle-10: ein scheiternder pg-boss-Lauf wird mit beiFehler gemeldet und im Takt nicht wiederholt", async (t) => {
  const clock = neueUhr();
  const { queue } = await pgBossUmgebung(t, { clock });
  const gemeldet = [];
  await queue.plane("did-release", SECHS_STUNDEN_MS, async () => Promise.reject(new Error("boss-kaputt")), {
    beiFehler: (f) => gemeldet.push(f.message),
  });
  await clock.setTime(clock.now() + 4 * STUNDE_MS - MINUTE_MS);
  await clock.tick(2 * MINUTE_MS);
  await clock.tick(30 * MINUTE_MS);
  assert.deepEqual(gemeldet, ["boss-kaputt"]);
  assert.deepEqual(await queue.ueberfaellige(), []);
});

test("Sechs-Intervalle-11: ohne übergebenen Zeitplan läuft die Session-Aufbewahrung im Prozess alle 6 Stunden", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const zaehler = { loeschungen: 0 };
  await scheduleSessionRetention(zaehlenderRunner(zaehler));
  assert.equal(zaehler.loeschungen, 1);
  t.mock.timers.tick(SECHS_STUNDEN_MS - 1);
  assert.equal(zaehler.loeschungen, 1);
  t.mock.timers.tick(1);
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(zaehler.loeschungen, 2);
});
