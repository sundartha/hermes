import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_fap_a";
const B = "t_fap_b";
const LEASE_MS = 60_000;
const ANFRAGE = { art: "abfrage", limitJeMandant: 10, leaseMs: LEASE_MS };

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

async function anruf(tenantId, id, { status = "active", abfrage = null, andereLease = null } = {}) {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, frist_abfrage_at, frist_geld_lease_bis, frist_lease_bis, frist_reserve_lease_bis)
     VALUES ($1, $2, $3, 'inbound', $4, now()::text,
       CASE WHEN $5::text IS NULL THEN NULL ELSE now() + $5::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END)`,
    [id, tenantId, `tok_${id}`, status, abfrage, andereLease],
  );
}

const zeile = async (tenantId, id) => {
  await kontext(tenantId);
  const { rows } = await db.query(
    `SELECT frist_abfrage_at AS abfrage, frist_abfrage_versuche::int AS versuche,
       frist_abfrage_lease_bis > now() + interval '50 seconds' AS lease_lang,
       frist_abfrage_lease_bis < now() + interval '70 seconds' AS lease_kurz,
       frist_versuche::int AS hoechstdauer_versuche, frist_reserve_versuche::int AS reserve_versuche
     FROM call WHERE id = $1`,
    [id],
  );
  return rows[0];
};

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Abfrage-Frist: findet faellige Abfragen aktiver Anrufe aller Mandanten, nicht kuenftige, nicht beendete und nicht Zeilen ohne Frist", async () => {
  await anruf(A, "f_a_aktiv", { abfrage: "-1 minute" });
  await anruf(B, "f_b_aktiv", { abfrage: "-2 hours" });
  await anruf(A, "f_a_spaeter", { abfrage: "1 hour" });
  await anruf(A, "f_a_beendet", { abfrage: "-1 minute", status: "completed" });
  await anruf(A, "f_a_ohne");
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), ["f_a_aktiv", "f_b_aktiv"]);
  const b = treffer.find((eintrag) => eintrag.callId === "f_b_aktiv");
  assert.equal(b.tenantId, B);
  assert.equal(b.versuche, 1);
  assert.ok(Date.parse(b.faelligAt) < Date.now() - 3_600_000);
});

test("Abfrage-Frist: das Holen setzt eine eigene Lease und zaehlt einen Versuch, die anderen Fristen bleiben unberuehrt; zwei Holer bekommen die Zeile nicht beide", async () => {
  await anruf(A, "f_lease", { abfrage: "-1 minute" });
  assert.deepEqual(ids(await speicher.faelligeFristen(ANFRAGE)).filter((id) => id === "f_lease"), ["f_lease"]);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes("f_lease"));
  const nach = await zeile(A, "f_lease");
  assert.equal(nach.versuche, 1);
  assert.equal(nach.lease_lang, true);
  assert.equal(nach.lease_kurz, true);
  assert.equal(nach.hoechstdauer_versuche, 0);
  assert.equal(nach.reserve_versuche, 0);
  await kontext(A);
  await db.query("UPDATE call SET frist_abfrage_lease_bis = now() - interval '1 second' WHERE id = 'f_lease'");
  const wieder = (await speicher.faelligeFristen(ANFRAGE)).find((eintrag) => eintrag.callId === "f_lease");
  assert.equal(wieder.versuche, 2);
});

test("Abfrage-Frist: eine Hoechstdauer-, Geld- oder Reserve-Lease sperrt die Abfrage-Frist nicht", async () => {
  await anruf(A, "f_fremde_lease", { abfrage: "-1 minute", andereLease: "1 hour" });
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes("f_fremde_lease"));
});

test("Abfrage-Frist: das Limit gilt je Mandant, die aelteste Abfrage kommt zuerst", async () => {
  await anruf(A, "fl_a_alt", { abfrage: "-3 hours" });
  await anruf(A, "fl_a_neu", { abfrage: "-1 hour" });
  await anruf(B, "fl_b_alt", { abfrage: "-3 hours" });
  await anruf(B, "fl_b_neu", { abfrage: "-1 hour" });
  const treffer = ids(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((id) => id.startsWith("fl_"));
  assert.deepEqual(treffer, ["fl_a_alt", "fl_b_alt"]);
});

test("Abfrage-Frist: die Geld- und die Reserve-Abfrage finden einen Anruf mit Abfrage-Frist nicht", async () => {
  await anruf(A, "f_nur_abfrage", { abfrage: "-1 minute" });
  for (const art of ["geld", "reserve"])
    assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art })).includes("f_nur_abfrage"));
});

test("Abfrage-Frist schreiben: setzt die Frist eines aktiven Anrufs auf genau den Zeitpunkt und die Versuche zurueck", async () => {
  await anruf(A, "fs_aktiv", { abfrage: "-1 minute" });
  await speicher.faelligeFristen(ANFRAGE);
  assert.equal((await zeile(A, "fs_aktiv")).versuche, 1);
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeAbfrageFrist({ callId: "fs_aktiv", tenantId: A, faelligAt });
  const nach = await zeile(A, "fs_aktiv");
  assert.equal(nach.abfrage.toISOString(), faelligAt);
  assert.equal(nach.versuche, 0);
});

test("Abfrage-Frist schreiben: ein beendeter Anruf und der Anruf eines anderen Mandanten bleiben unveraendert", async () => {
  await anruf(A, "fs_beendet", { abfrage: "1 hour", status: "completed" });
  await anruf(B, "fs_fremd", { abfrage: "1 hour" });
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeAbfrageFrist({ callId: "fs_beendet", tenantId: A, faelligAt });
  await speicher.setzeAbfrageFrist({ callId: "fs_fremd", tenantId: A, faelligAt });
  assert.notEqual((await zeile(A, "fs_beendet")).abfrage.toISOString(), faelligAt);
  assert.notEqual((await zeile(B, "fs_fremd")).abfrage.toISOString(), faelligAt);
});

test("Abfrage-Frist schreiben: ein Anruf, dessen Zeile noch im ausstehenden Schreiben steht, bekommt die Frist trotzdem", async () => {
  await speicher.zustandNachladen();
  const call = speicher.createCall({ direction: "outbound", from: "+4915112340002", to: "+4930555000303", goal: "Abfrage", tenantId: A });
  call.status = "active";
  const faelligAt = "2032-01-02T03:04:05.000Z";
  await speicher.setzeAbfrageFrist({ callId: call.id, tenantId: A, faelligAt });
  await speicher.drainFlushes();
  assert.equal((await zeile(A, call.id)).abfrage.toISOString(), faelligAt);
});
