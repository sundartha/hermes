import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";

const A = "t_fr_a";
const B = "t_fr_b";
const LEASE_MS = 60_000;
const ANFRAGE = { art: "reserve", limitJeMandant: 10, leaseMs: LEASE_MS };

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { pgliteAlsRolleOhneSuperuser } = await import("../pg-helpers.js");
const { poolAufPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const db = await pgliteAlsRolleOhneSuperuser();
poolAufPglite(db);
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);

const kontext = (tenantId) => db.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);

for (const id of [A, B]) {
  await kontext(id);
  await db.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [id]);
}

async function anruf(tenantId, id, { status = "completed", reserve = null, geldLease = null, hoechstdauerLease = null } = {}) {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, frist_reserve_at, frist_geld_lease_bis, frist_lease_bis)
     VALUES ($1, $2, $3, 'outbound', $4, now()::text,
       CASE WHEN $5::text IS NULL THEN NULL ELSE now() + $5::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END,
       CASE WHEN $7::text IS NULL THEN NULL ELSE now() + $7::interval END)`,
    [id, tenantId, `tok_${id}`, status, reserve, geldLease, hoechstdauerLease],
  );
}

async function reservierung(tenantId, callId, cents) {
  await kontext(tenantId);
  await db.query("INSERT INTO budget_reservierung (call_id, tenant_id, cents, ablauf_um) VALUES ($1, $2, $3, now() + interval '1 hour')", [
    callId,
    tenantId,
    cents,
  ]);
}

const offeneReserve = async (tenantId) => {
  await kontext(tenantId);
  const { rows } = await db.query("SELECT call_id FROM budget_reservierung WHERE tenant_id = $1 ORDER BY call_id", [tenantId]);
  return rows.map((zeile) => zeile.call_id);
};

const zeile = async (tenantId, id) => {
  await kontext(tenantId);
  const { rows } = await db.query(
    `SELECT frist_reserve_at AS reserve, frist_reserve_versuche::int AS versuche,
       frist_reserve_lease_bis > now() + interval '50 seconds' AS lease_lang,
       frist_reserve_lease_bis < now() + interval '70 seconds' AS lease_kurz,
       frist_lease_bis, frist_geld_lease_bis, frist_versuche::int AS hoechstdauer_versuche
     FROM call WHERE id = $1`,
    [id],
  );
  return rows[0];
};

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Reserve-Frist: findet faellige Reserven aller Mandanten, auch beendeter Anrufe, nicht kuenftige und nicht Zeilen ohne Frist", async () => {
  await anruf(A, "r_a_beendet", { reserve: "-1 minute" });
  await anruf(B, "r_b_aktiv", { reserve: "-2 hours", status: "active" });
  await anruf(A, "r_a_spaeter", { reserve: "1 hour" });
  await anruf(A, "r_a_ohne");
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), ["r_a_beendet", "r_b_aktiv"]);
  const b = treffer.find((eintrag) => eintrag.callId === "r_b_aktiv");
  assert.equal(b.tenantId, B);
  assert.equal(b.versuche, 1);
  assert.ok(Date.parse(b.faelligAt) < Date.now() - 3_600_000);
});

test("Reserve-Frist: das Holen setzt eine eigene Lease und zaehlt einen Versuch, Hoechstdauer- und Geld-Spalten bleiben unberuehrt", async () => {
  await anruf(A, "r_lease", { reserve: "-1 minute" });
  assert.deepEqual(ids(await speicher.faelligeFristen(ANFRAGE)).filter((id) => id === "r_lease"), ["r_lease"]);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes("r_lease"));
  const nach = await zeile(A, "r_lease");
  assert.equal(nach.versuche, 1);
  assert.equal(nach.lease_lang, true);
  assert.equal(nach.lease_kurz, true);
  assert.equal(nach.frist_lease_bis, null);
  assert.equal(nach.frist_geld_lease_bis, null);
  assert.equal(nach.hoechstdauer_versuche, 0);
  await kontext(A);
  await db.query("UPDATE call SET frist_reserve_lease_bis = now() - interval '1 second' WHERE id = 'r_lease'");
  const wieder = (await speicher.faelligeFristen(ANFRAGE)).find((eintrag) => eintrag.callId === "r_lease");
  assert.equal(wieder.versuche, 2);
});

test("Reserve-Frist: eine Hoechstdauer- oder Geld-Lease sperrt die Reserve-Frist nicht", async () => {
  await anruf(A, "r_fremde_lease", { reserve: "-1 minute", geldLease: "1 hour", hoechstdauerLease: "1 hour" });
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes("r_fremde_lease"));
});

test("Reserve-Frist: das Limit gilt je Mandant, die aelteste Reserve kommt zuerst", async () => {
  await anruf(A, "rl_a_alt", { reserve: "-3 hours" });
  await anruf(A, "rl_a_neu", { reserve: "-1 hour" });
  await anruf(B, "rl_b_alt", { reserve: "-3 hours" });
  await anruf(B, "rl_b_neu", { reserve: "-1 hour" });
  const treffer = ids(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((id) => id.startsWith("rl_"));
  assert.deepEqual(treffer, ["rl_a_alt", "rl_b_alt"]);
});

test("Reserve-Frist: die Hoechstdauer- und die Geld-Abfrage finden einen beendeten Anruf mit Reserve-Frist nicht", async () => {
  await anruf(A, "r_nur_reserve", { reserve: "-1 minute" });
  for (const art of ["hoechstdauer", "geld"])
    assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art })).includes("r_nur_reserve"));
});

test("Reserve-Frist schreiben: setzt die Frist auch eines beendeten Anrufs auf genau den Zeitpunkt und setzt die Versuche zurueck", async () => {
  await anruf(A, "rs_beendet", { reserve: "-1 minute" });
  await speicher.faelligeFristen(ANFRAGE);
  assert.equal((await zeile(A, "rs_beendet")).versuche, 1);
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeReserveFrist({ callId: "rs_beendet", tenantId: A, faelligAt });
  const nach = await zeile(A, "rs_beendet");
  assert.equal(nach.reserve.toISOString(), faelligAt);
  assert.equal(nach.versuche, 0);
});

test("Reserve-Frist schreiben: null leert die Frist, der Anruf eines anderen Mandanten bleibt unveraendert", async () => {
  await anruf(A, "rs_leeren", { reserve: "1 hour" });
  await anruf(B, "rs_fremd", { reserve: "1 hour" });
  await speicher.setzeReserveFrist({ callId: "rs_leeren", tenantId: A, faelligAt: null });
  await speicher.setzeReserveFrist({ callId: "rs_fremd", tenantId: A, faelligAt: null });
  assert.equal((await zeile(A, "rs_leeren")).reserve, null);
  assert.notEqual((await zeile(B, "rs_fremd")).reserve, null);
});

test("Reserve-Frist schreiben: ein Anruf, dessen Zeile noch im ausstehenden Schreiben steht, bekommt die Frist trotzdem", async () => {
  await speicher.zustandNachladen();
  const call = speicher.createCall({ direction: "outbound", from: "+4915112340002", to: "+4930555000302", goal: "Reserve", tenantId: A });
  const faelligAt = "2032-01-02T03:04:05.000Z";
  await speicher.setzeReserveFrist({ callId: call.id, tenantId: A, faelligAt });
  await speicher.drainFlushes();
  assert.equal((await zeile(A, call.id)).reserve.toISOString(), faelligAt);
});

test("Reserve-Frist nach Neustart: der Lauf eines Prozesses ohne den Anruf gibt die Reserve in der Datenbank frei und leert die Frist, eine zweite Runde aendert nichts", async () => {
  await anruf(A, "rn_neustart", { reserve: "-1 minute" });
  await anruf(A, "rn_andere", { reserve: "1 hour" });
  await reservierung(A, "rn_neustart", 40);
  await reservierung(A, "rn_andere", 25);
  const lauf = makeFristenLauf({
    store: speicher,
    beende: async () => {},
    limitJeMandant: 10,
    leaseMs: LEASE_MS,
    reserve: { freigeben: (call) => speicher.budgetReservierung.freigeben({ callId: call.id, tenantId: call.tenantId }) },
  });
  assert.deepEqual(await lauf.reserveTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(await offeneReserve(A), ["rn_andere"]);
  assert.equal((await zeile(A, "rn_neustart")).reserve, null);
  assert.notEqual((await zeile(A, "rn_andere")).reserve, null);
  assert.deepEqual(await lauf.reserveTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(await offeneReserve(A), ["rn_andere"]);
});
