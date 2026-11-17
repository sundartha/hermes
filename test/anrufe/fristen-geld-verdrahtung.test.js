import { test } from "node:test";
import assert from "node:assert/strict";
import { starteFristenTakt } from "../../src/boot.js";

const TAKT_MS = 40;
const LIMIT = 3;
const WACHE_MS = 5000;
const JETZT_MS = 1_800_000_000_000;
const ANRUF = { id: "call_vd", twilioSid: "CA_vd", tenantId: "tenant_vd", status: "active" };

function aufbau(t, { wacheMs, ueberBudget }) {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: JETZT_MS });
  const abgelaufen = { arten: [], achsen: [], beendet: [], gesetzt: [] };
  const store = {
    faelligeFristen: async ({ art, limitJeMandant, leaseMs }) => {
      abgelaufen.arten.push({ art, limitJeMandant, leaseMs });
      return art === "geld" ? [{ callId: ANRUF.id, tenantId: ANRUF.tenantId, faelligAt: "x", versuche: 1 }] : [];
    },
    attachActiveCall: async () => ANRUF,
    getCall: () => ({ ...ANRUF, status: abgelaufen.beendet.length ? "completed" : "active" }),
    setzeGeldFrist: async (frist) => abgelaufen.gesetzt.push(frist),
  };
  const lifecycle = {
    terminateExpiredCall: async () => {},
    blockingAxisFor: async (call) => {
      abgelaufen.achsen.push(call);
      return ueberBudget ? "budget_tenant" : null;
    },
    terminateOverBudgetExpired: async (call) => abgelaufen.beendet.push(call),
  };
  const takt = starteFristenTakt({
    store,
    lifecycle,
    config: { safety: { budgetWatchdogIntervalMs: wacheMs } },
    fristen: { fristenTaktMs: TAKT_MS, fristenLimitJeMandant: LIMIT },
  });
  t.after(() => takt.stoppen());
  const tick = async () => {
    t.mock.timers.tick(TAKT_MS);
    for (let runde = 0; runde < 5; runde++) await new Promise((erfuellen) => setImmediate(erfuellen));
  };
  return { abgelaufen, tick };
}

test("Geld-Verdrahtung: mit Geld-Wache liest der Boot-Takt Hoechstdauer und Geld mit Limit und Lease des Taktes", async (t) => {
  const { abgelaufen, tick } = aufbau(t, { wacheMs: WACHE_MS, ueberBudget: false });
  await tick();
  assert.deepEqual(abgelaufen.arten, [
    { art: "hoechstdauer", limitJeMandant: LIMIT, leaseMs: TAKT_MS },
    { art: "geld", limitJeMandant: LIMIT, leaseMs: TAKT_MS },
  ]);
});

test("Geld-Verdrahtung: reicht die Kostendecke nicht, steht die naechste Pruefung die Wache-Frist nach der Uhr des Prozesses an", async (t) => {
  const { abgelaufen, tick } = aufbau(t, { wacheMs: WACHE_MS, ueberBudget: false });
  await tick();
  assert.deepEqual(abgelaufen.achsen, [ANRUF]);
  assert.deepEqual(abgelaufen.beendet, []);
  assert.deepEqual(abgelaufen.gesetzt, [
    { callId: ANRUF.id, tenantId: ANRUF.tenantId, faelligAt: new Date(JETZT_MS + TAKT_MS + WACHE_MS).toISOString() },
  ]);
});

test("Geld-Verdrahtung: ist die Kostendecke erreicht, beendet der Boot-Takt den Anruf ueber das Geld-Ende der Lebensdauer-Verwaltung", async (t) => {
  const { abgelaufen, tick } = aufbau(t, { wacheMs: WACHE_MS, ueberBudget: true });
  await tick();
  assert.deepEqual(abgelaufen.beendet, [ANRUF]);
  assert.deepEqual(abgelaufen.gesetzt, []);
});

test("Geld-Verdrahtung: ist die Geld-Wache abgeschaltet (Intervall 0), liest der Boot-Takt keine Geld-Fristen", async (t) => {
  const { abgelaufen, tick } = aufbau(t, { wacheMs: 0, ueberBudget: true });
  await tick();
  assert.deepEqual(abgelaufen.arten.map((eintrag) => eintrag.art), ["hoechstdauer"]);
  assert.deepEqual(abgelaufen.beendet, []);
});
