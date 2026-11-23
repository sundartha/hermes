import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as naechsterTakt } from "node:timers/promises";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_va_a";
const B = "t_va_b";

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { pgliteAlsRolleOhneSuperuser } = await import("../pg-helpers.js");
const { poolAufPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const db = await pgliteAlsRolleOhneSuperuser();
poolAufPglite(db);
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);
const { runSweepTick } = await import("../../src/boot.js");

const kontext = (tenantId) => db.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
const nichts = async () => ({});
const wachen = (vorspannZustand) => ({
  costTruing: { runCostTruingSweep: nichts },
  provisioning: { settleDueNumberMonthMeters: nichts },
  costCrossCheck: { runMonthlyCrossCheck: nichts },
  outageWatch: { runRecoverySweep: nichts, runAlertChannelSelfTest: nichts, runHoldEscalationSweep: nichts },
  paidWithoutNumberWatch: { runPaidWithoutNumberSweep: nichts },
  provisionRetryWatch: { runProvisionRetrySweep: nichts },
  priceDriftWatch: { runPriceDriftSweep: nichts },
  vorspannZustand,
});

for (const id of [A, B]) {
  await kontext(id);
  await db.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [id]);
}

const zeile = async (tenantId, callId) => {
  await kontext(tenantId);
  const { rows } = await db.query("SELECT token, text FROM vorspann_zustand WHERE call_id = $1", [callId]);
  return rows[0];
};

const anlegen = async (tenantId, callId, ablauf) => {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at) VALUES ($1, $2, $3, $4, now() + $5::interval)`,
    [callId, tenantId, `tok_${callId}`, `satz_${callId}`, ablauf],
  );
};

const MAX_TAKTE = 5000;

const fehlerAufgefangen = async (lauf, fertig) => {
  const zeilen = [];
  const bisher = console.error;
  console.error = (...teile) => zeilen.push(teile.join(" "));
  try {
    lauf();
    for (let takt = 0; takt < MAX_TAKTE && !(await fertig(zeilen)); takt += 1) await naechsterTakt();
  } finally {
    console.error = bisher;
  }
  return zeilen;
};

test("Vorspann-Aufraeumen: der Sweep loescht die abgelaufene Zeile von Mandant B, ohne dass B anlegt; Zukunftszeilen beider Mandanten bleiben", async () => {
  await anlegen(B, "va_b_alt", "-1 hour");
  await anlegen(A, "va_a_alt", "-1 second");
  await anlegen(B, "va_b_neu", "1 hour");
  await anlegen(A, "va_a_neu", "1 hour");
  await fehlerAufgefangen(() => runSweepTick(wachen(speicher.vorspannZustand)), async () => !(await zeile(B, "va_b_alt")));
  assert.equal(await zeile(B, "va_b_alt"), undefined);
  assert.equal(await zeile(A, "va_a_alt"), undefined);
  assert.deepEqual(await zeile(B, "va_b_neu"), { token: "tok_va_b_neu", text: "satz_va_b_neu" });
  assert.deepEqual(await zeile(A, "va_a_neu"), { token: "tok_va_a_neu", text: "satz_va_a_neu" });
});

test("Vorspann-Aufraeumen: ein Fehler beim Aufraeumen wird mit [vorspann-aufraeumen] geloggt und die anderen Teillaeufe laufen", async () => {
  let gerufen = false;
  const gebrochen = { raeumeAbgelaufene: async () => { throw new Error("db weg"); } };
  const ganze = { ...wachen(gebrochen), priceDriftWatch: { runPriceDriftSweep: async () => { gerufen = true; } } };
  const zeilen = await fehlerAufgefangen(() => runSweepTick(ganze), (gefangen) => gefangen.length > 0);
  assert.deepEqual(zeilen, ["[vorspann-aufraeumen] db weg"]);
  assert.equal(gerufen, true);
});

test("Vorspann-Aufraeumen: anlegen loescht weiterhin abgelaufene Zeilen des eigenen Mandanten", async () => {
  await anlegen(A, "va_a_eigen_alt", "-1 hour");
  await speicher.vorspannZustand.anlegen({ tenantId: A, callId: "va_a_eigen_neu", token: "t", text: "s", ttlMs: 60_000 });
  assert.equal(await zeile(A, "va_a_eigen_alt"), undefined);
  assert.equal((await zeile(A, "va_a_eigen_neu")).text, "s");
});
