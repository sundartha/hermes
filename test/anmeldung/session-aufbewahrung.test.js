import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { makeAccounts } from "../../src/web-auth.js";
import { makePgTestStore } from "../pg-helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

const KUNDE_SUB = "sub-aufbewahrung";
const FRIST_TAGE = 30;
const SECHS_STUNDEN_MS = 6 * 60 * 60 * 1000;

const SITZUNGEN = [
  { id: "s-abgelaufen-31", ablauf: `now() - interval '31 days'`, ungueltig: "NULL", bleibt: false },
  { id: "s-abgelaufen-29", ablauf: `now() - interval '29 days'`, ungueltig: "NULL", bleibt: true },
  { id: "s-aktiv", ablauf: `now() + interval '1 hour'`, ungueltig: "NULL", bleibt: true },
  { id: "s-ungueltig-31", ablauf: `now() + interval '1 hour'`, ungueltig: `now() - interval '31 days'`, bleibt: false },
  { id: "s-ungueltig-29", ablauf: `now() - interval '40 days'`, ungueltig: `now() - interval '29 days'`, bleibt: true },
];

async function aufbauen() {
  const { store, runner } = await makePgTestStore();
  const konto = await makeAccounts(runner).upsertOnFirstLogin({ sub: KUNDE_SUB, email: "aufbewahrung@x.test" });
  for (const s of SITZUNGEN)
    await runner.withClient((c) =>
      c.query(
        `INSERT INTO session (id, sub, tenant_id, expires_at, invalidated_at)
         VALUES ($1, $2, $3, ${s.ablauf}, ${s.ungueltig})`,
        [s.id, KUNDE_SUB, konto.tenantId],
      ),
    );
  return { store, runner };
}

async function vorhandene(runner) {
  const { rows } = await runner.withClient((c) => c.query(`SELECT id FROM session ORDER BY id`));
  return rows.map((r) => r.id);
}

function erwartet(bleibt) {
  return SITZUNGEN.filter((s) => s.bleibt === bleibt)
    .map((s) => s.id)
    .sort();
}

async function hochfahren({ store, runner }) {
  const app = express();
  await wireWebLogin({
    app,
    config: webLoginBasisKonfiguration("https://api.workos.test"),
    store,
    audit: () => {},
    provision: async () => ({ reason: "dry_run" }),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
  });
}

test("Aufraeumlauf beim Start loescht Sessions nach Fristablauf, die uebrigen bleiben", async () => {
  const s = await aufbauen();
  const log = mock.method(console, "log", () => {});
  try {
    await hochfahren(s);
    assert.deepEqual(await vorhandene(s.runner), erwartet(true));
    assert.ok(
      log.mock.calls.some((aufruf) => aufruf.arguments[0] === `[retention] 2 Sessions geloescht (aelter als ${FRIST_TAGE} Tage)`),
      "Lauf-Log nennt die Zahl",
    );
  } finally {
    log.mock.restore();
  }
});

test("Aufraeumlauf wiederholt sich alle 6 Stunden, nicht frueher", async () => {
  const s = await aufbauen();
  const stumm = [mock.method(console, "log", () => {}), mock.method(console, "error", () => {})];
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    await hochfahren(s);
    await s.runner.withClient((c) =>
      c.query(`UPDATE session SET expires_at = now() - interval '40 days' WHERE id = 's-aktiv'`),
    );
    mock.timers.tick(SECHS_STUNDEN_MS - 1);
    assert.ok((await vorhandene(s.runner)).includes("s-aktiv"), "vor Ablauf der 6 Stunden kein Lauf");
    mock.timers.tick(1);
    assert.ok(!(await vorhandene(s.runner)).includes("s-aktiv"), "nach 6 Stunden laeuft er erneut");
  } finally {
    mock.timers.reset();
    for (const m of stumm) m.mock.restore();
  }
});

test("Fehler beim Aufraeumen wird mit [retention] geloggt, ohne Session-IDs, und wirft nicht", async () => {
  const s = await aufbauen();
  const ausfallRunner = {
    withClient: (fn) =>
      fn({
        query: (text, parameter) =>
          text.includes("DELETE FROM session")
            ? Promise.reject(new Error("verbindung weg"))
            : s.runner.withClient((c) => c.query(text, parameter)),
      }),
  };
  const fehler = mock.method(console, "error", () => {});
  try {
    await hochfahren({ ...s, runner: ausfallRunner });
    const zeilen = fehler.mock.calls.map((aufruf) => aufruf.arguments);
    assert.deepEqual(zeilen, [["[retention] Session-Aufraeumen fehlgeschlagen:", "verbindung weg"]]);
    assert.deepEqual(await vorhandene(s.runner), SITZUNGEN.map((x) => x.id).sort());
  } finally {
    fehler.mock.restore();
  }
});

test("ohne abgelaufene Sessions schreibt der Lauf keine Retention-Zeile", async () => {
  const { store, runner } = await makePgTestStore();
  const log = mock.method(console, "log", () => {});
  try {
    await hochfahren({ store, runner });
    await vorhandene(runner);
    assert.deepEqual(
      log.mock.calls.filter((aufruf) => String(aufruf.arguments[0]).startsWith("[retention]")),
      [],
    );
  } finally {
    log.mock.restore();
  }
});
