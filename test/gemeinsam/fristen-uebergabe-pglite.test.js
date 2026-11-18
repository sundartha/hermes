import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_fup_a";
const B = "t_fup_b";
const LEASE_MS = 60_000;
const ANFRAGE = { art: "uebergabe", limitJeMandant: 10, leaseMs: LEASE_MS };

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

async function anruf(tenantId, id, { status = "active", uebergabe = null, andereLease = null } = {}) {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, frist_uebergabe_at, frist_geld_lease_bis, frist_lease_bis, frist_reserve_lease_bis, frist_abfrage_lease_bis)
     VALUES ($1, $2, $3, 'inbound', $4, now()::text,
       CASE WHEN $5::text IS NULL THEN NULL ELSE now() + $5::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END)`,
    [id, tenantId, `tok_${id}`, status, uebergabe, andereLease],
  );
}

const zeile = async (tenantId, id) => {
  await kontext(tenantId);
  const { rows } = await db.query(
    `SELECT frist_uebergabe_at AS uebergabe, frist_uebergabe_versuche::int AS versuche,
       frist_uebergabe_lease_bis > now() + interval '50 seconds' AS lease_lang,
       frist_uebergabe_lease_bis < now() + interval '70 seconds' AS lease_kurz,
       frist_versuche::int AS hoechstdauer_versuche, frist_abfrage_versuche::int AS abfrage_versuche
     FROM call WHERE id = $1`,
    [id],
  );
  return rows[0];
};

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Uebergabe-Frist: findet faellige Uebergaben aktiver Anrufe aller Mandanten, nicht kuenftige, nicht beendete und nicht Zeilen ohne Frist", async () => {
  await anruf(A, "u_a_aktiv", { uebergabe: "-1 minute" });
  await anruf(B, "u_b_aktiv", { uebergabe: "-2 hours" });
  await anruf(A, "u_a_spaeter", { uebergabe: "1 hour" });
  await anruf(A, "u_a_beendet", { uebergabe: "-1 minute", status: "completed" });
  await anruf(A, "u_a_ohne");
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), ["u_a_aktiv", "u_b_aktiv"]);
  const b = treffer.find((eintrag) => eintrag.callId === "u_b_aktiv");
  assert.equal(b.tenantId, B);
  assert.equal(b.versuche, 1);
  assert.ok(Date.parse(b.faelligAt) < Date.now() - 3_600_000);
});

test("Uebergabe-Frist: das Holen setzt eine eigene Lease und zaehlt einen Versuch, die anderen Fristen bleiben unberuehrt; zwei Holer bekommen die Zeile nicht beide", async () => {
  await anruf(A, "u_lease", { uebergabe: "-1 minute" });
  assert.deepEqual(ids(await speicher.faelligeFristen(ANFRAGE)).filter((id) => id === "u_lease"), ["u_lease"]);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes("u_lease"));
  const nach = await zeile(A, "u_lease");
  assert.equal(nach.versuche, 1);
  assert.equal(nach.lease_lang, true);
  assert.equal(nach.lease_kurz, true);
  assert.equal(nach.hoechstdauer_versuche, 0);
  assert.equal(nach.abfrage_versuche, 0);
  await kontext(A);
  await db.query("UPDATE call SET frist_uebergabe_lease_bis = now() - interval '1 second' WHERE id = 'u_lease'");
  const wieder = (await speicher.faelligeFristen(ANFRAGE)).find((eintrag) => eintrag.callId === "u_lease");
  assert.equal(wieder.versuche, 2);
});

test("Uebergabe-Frist: eine Hoechstdauer-, Geld-, Reserve- oder Abfrage-Lease sperrt die Uebergabe-Frist nicht", async () => {
  await anruf(A, "u_fremde_lease", { uebergabe: "-1 minute", andereLease: "1 hour" });
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes("u_fremde_lease"));
});

test("Uebergabe-Frist: das Limit gilt je Mandant, die aelteste Uebergabe kommt zuerst", async () => {
  await anruf(A, "ul_a_alt", { uebergabe: "-3 hours" });
  await anruf(A, "ul_a_neu", { uebergabe: "-1 hour" });
  await anruf(B, "ul_b_alt", { uebergabe: "-3 hours" });
  await anruf(B, "ul_b_neu", { uebergabe: "-1 hour" });
  const treffer = ids(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((id) => id.startsWith("ul_"));
  assert.deepEqual(treffer, ["ul_a_alt", "ul_b_alt"]);
});

test("Uebergabe-Frist: die anderen Arten finden einen Anruf mit Uebergabe-Frist nicht", async () => {
  await anruf(A, "u_nur_uebergabe", { uebergabe: "-1 minute" });
  for (const art of ["reserve", "abfrage"])
    assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art })).includes("u_nur_uebergabe"));
});

test("Uebergabe-Frist schreiben: setzt die Frist eines aktiven Anrufs auf genau den Zeitpunkt und die Versuche zurueck", async () => {
  await anruf(A, "us_aktiv", { uebergabe: "-1 minute" });
  await speicher.faelligeFristen(ANFRAGE);
  assert.equal((await zeile(A, "us_aktiv")).versuche, 1);
  const faelligAt = "2020-05-06T07:08:09.000Z";
  await speicher.setzeUebergabeFrist({ callId: "us_aktiv", tenantId: A, faelligAt });
  const nach = await zeile(A, "us_aktiv");
  assert.equal(nach.uebergabe.toISOString(), faelligAt);
  assert.equal(nach.versuche, 0);
});

test("Uebergabe-Frist schreiben: eine spaetere Frist ersetzt eine fruehere nicht, eine fruehere ersetzt eine spaetere, null leert", async () => {
  await anruf(A, "us_min");
  await speicher.setzeUebergabeFrist({ callId: "us_min", tenantId: A, faelligAt: "2031-05-06T07:08:09.000Z" });
  await speicher.setzeUebergabeFrist({ callId: "us_min", tenantId: A, faelligAt: "2032-05-06T07:08:09.000Z" });
  assert.equal((await zeile(A, "us_min")).uebergabe.toISOString(), "2031-05-06T07:08:09.000Z");
  await speicher.setzeUebergabeFrist({ callId: "us_min", tenantId: A, faelligAt: "2030-05-06T07:08:09.000Z" });
  assert.equal((await zeile(A, "us_min")).uebergabe.toISOString(), "2030-05-06T07:08:09.000Z");
  await speicher.setzeUebergabeFrist({ callId: "us_min", tenantId: A, faelligAt: null });
  assert.equal((await zeile(A, "us_min")).uebergabe, null);
});

test("Uebergabe-Frist schreiben: ein beendeter Anruf und der Anruf eines anderen Mandanten bleiben unveraendert", async () => {
  await anruf(A, "us_beendet", { uebergabe: "1 hour", status: "completed" });
  await anruf(B, "us_fremd", { uebergabe: "1 hour" });
  const faelligAt = "2020-05-06T07:08:09.000Z";
  await speicher.setzeUebergabeFrist({ callId: "us_beendet", tenantId: A, faelligAt });
  await speicher.setzeUebergabeFrist({ callId: "us_fremd", tenantId: A, faelligAt });
  assert.notEqual((await zeile(A, "us_beendet")).uebergabe.toISOString(), faelligAt);
  assert.notEqual((await zeile(B, "us_fremd")).uebergabe.toISOString(), faelligAt);
});

test("Uebergabe-Frist schreiben: ein Anruf, dessen Zeile noch im ausstehenden Schreiben steht, bekommt die Frist trotzdem", async () => {
  await speicher.zustandNachladen();
  const call = speicher.createCall({ direction: "inbound", from: "+4915112340002", to: "+4930555000303", tenantId: A });
  call.status = "active";
  const faelligAt = "2032-01-02T03:04:05.000Z";
  await speicher.setzeUebergabeFrist({ callId: call.id, tenantId: A, faelligAt });
  await speicher.drainFlushes();
  assert.equal((await zeile(A, call.id)).uebergabe.toISOString(), faelligAt);
});
