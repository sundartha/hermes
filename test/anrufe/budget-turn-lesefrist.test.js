import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { blockingBudgetAxisFrisch } from "../../src/budget-gate.js";

function store({ sql, spiegel }) {
  const gesehen = [];
  return {
    gesehen,
    nutzungAuffrischen: async () => {},
    activeCallsForSql: sql,
    activeCallsFor: () => {
      gesehen.push("spiegel");
      return spiegel;
    },
    liveBudgetExceeded: (_tenantId, liveCents) => {
      gesehen.push(liveCents);
      return liveCents > 0;
    },
  };
}

const laufend = [{ id: "c1", startedAt: new Date(Date.now() - 600000).toISOString(), tenantId: "t1" }];

test("Turn-Kostendecke: Lesefehler der Datenbank prueft mit dem Spiegel des Prozesses", async () => {
  const fehler = mock.method(console, "error", () => {});
  const s = store({
    sql: async () => {
      throw new Error("db weg");
    },
    spiegel: [],
  });
  const achse = await blockingBudgetAxisFrisch({ store: s, billing: {}, tenantId: "t1" });
  fehler.mock.restore();
  assert.equal(achse, null);
  assert.deepEqual(s.gesehen, ["spiegel", 0]);
});

test("Turn-Kostendecke: haengender Lesevorgang endet nach der Frist mit dem Spiegel", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fehler = mock.method(console, "error", () => {});
  const s = store({ sql: () => new Promise(() => {}), spiegel: laufend });
  const lauf = blockingBudgetAxisFrisch({ store: s, billing: {}, tenantId: "t1" });
  await new Promise((weiter) => setImmediate(weiter));
  mock.timers.tick(500);
  const achse = await lauf;
  mock.timers.reset();
  const meldungen = fehler.mock.calls.map((aufruf) => aufruf.arguments[0]);
  fehler.mock.restore();
  assert.equal(achse, "budget_tenant");
  assert.deepEqual(s.gesehen.slice(0, 1), ["spiegel"]);
  assert.equal(meldungen.length, 1);
  assert.match(meldungen[0], /^\[budget\] laufende Anrufe nicht binnen der Frist gelesen/);
});

test("Turn-Kostendecke: rechtzeitige Antwort der Datenbank gilt, der Spiegel bleibt ungelesen", async () => {
  const s = store({ sql: async () => laufend, spiegel: [] });
  const achse = await blockingBudgetAxisFrisch({ store: s, billing: {}, tenantId: "t1" });
  assert.equal(achse, "budget_tenant");
  assert.equal(s.gesehen.includes("spiegel"), false);
});
