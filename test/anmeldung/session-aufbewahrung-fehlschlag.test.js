import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { makePgTestStore } from "../pg-helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

const ABGELAUFEN_NACH_TAGEN = 30;
const SECHS_STUNDEN_MS = 6 * 60 * 60 * 1000;
const FEHLER_ZEILE = ["[retention] Session-Aufraeumen fehlgeschlagen:", "verbindung weg"];

function ausfallRunner(runner) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, parameter) =>
          text.includes("DELETE FROM session")
            ? Promise.reject(new Error("verbindung weg"))
            : runner.withClient((c) => c.query(text, parameter)),
      }),
  };
}

function aufzeichnenderZeitplan() {
  const angemeldet = new Map();
  return {
    angemeldet,
    plane: async (name, intervallMs, lauf) => {
      angemeldet.set(name, { intervallMs, lauf });
    },
  };
}

async function hochfahren(runner, store) {
  const zeitplan = aufzeichnenderZeitplan();
  const { zeitplaeneAnmelden } = await wireWebLogin({
    app: express(),
    config: webLoginBasisKonfiguration("https://api.workos.test"),
    store,
    audit: () => {},
    provision: async () => ({ ok: true, wert: { reason: "dry_run" } }),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
    zeitplan,
  });
  await zeitplaeneAnmelden();
  await new Promise((fertig) => setImmediate(fertig));
  return zeitplan.angemeldet.get("session-aufbewahrung");
}

function retentionZeilen(spion) {
  const aufrufe = spion.mock.calls;
  const zeilen = aufrufe.map((aufruf) => aufruf.arguments);
  return zeilen.filter((zeile) => String(zeile[0]).startsWith("[retention]"));
}

test("Periodischer Lauf wirft bei Fehler der Loeschabfrage, damit kein Herzschlag gesetzt wird", async () => {
  const { store, runner } = await makePgTestStore();
  const fehler = mock.method(console, "error", () => {});
  try {
    const plan = await hochfahren(ausfallRunner(runner), store);
    assert.equal(plan.intervallMs, SECHS_STUNDEN_MS);
    await assert.rejects(() => plan.lauf.lauf(), { message: "verbindung weg" });
  } finally {
    fehler.mock.restore();
  }
});

test("Fehler im periodischen Lauf wird ueber beiFehler geloggt", async () => {
  const { store, runner } = await makePgTestStore();
  const fehler = mock.method(console, "error", () => {});
  try {
    const plan = await hochfahren(ausfallRunner(runner), store);
    fehler.mock.resetCalls();
    plan.lauf.beiFehler(new Error("verbindung weg"));
    assert.deepEqual(retentionZeilen(fehler), [FEHLER_ZEILE]);
  } finally {
    fehler.mock.restore();
  }
});

test("Start-Lauf bei Boot loggt den Fehler einmal und wirft nicht ungefangen", async () => {
  const { store, runner } = await makePgTestStore();
  const fehler = mock.method(console, "error", () => {});
  try {
    await hochfahren(ausfallRunner(runner), store);
    assert.deepEqual(retentionZeilen(fehler), [FEHLER_ZEILE]);
  } finally {
    fehler.mock.restore();
  }
});

test("Erfolgreicher periodischer Lauf loescht nach 30 Tagen, loggt die Zahl und wirft nicht", async () => {
  const { store, runner } = await makePgTestStore();
  const parameter = [];
  const zaehlender = {
    withClient: (fn) =>
      fn({
        query: (text, p) => {
          if (!text.includes("DELETE FROM session")) return runner.withClient((c) => c.query(text, p));
          parameter.push(p);
          return Promise.resolve({ rows: [{ id: "a" }, { id: "b" }] });
        },
      }),
  };
  const log = mock.method(console, "log", () => {});
  try {
    const plan = await hochfahren(zaehlender, store);
    log.mock.resetCalls();
    assert.equal(await plan.lauf.lauf(), 2);
    assert.deepEqual(parameter.at(-1), [ABGELAUFEN_NACH_TAGEN]);
    assert.deepEqual(retentionZeilen(log), [[`[retention] 2 Sessions geloescht (aelter als ${ABGELAUFEN_NACH_TAGEN} Tage)`]]);
  } finally {
    log.mock.restore();
  }
});
