import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_fg_a";
const B = "t_fg_b";
const LEASE_MS = 60_000;
const MINUTE_MS = 60_000;
const ANFRAGE = { art: "geld", limitJeMandant: 10, leaseMs: LEASE_MS };

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

async function anruf(tenantId, id, { status = "active", geld = null, abgehobenVorMs = null, hoechstdauerLease = null } = {}) {
  await kontext(tenantId);
  const abgehoben = abgehobenVorMs === null ? null : new Date(Date.now() - abgehobenVorMs).toISOString();
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, frist_geld_at, frist_lease_bis)
     VALUES ($1, $2, $3, 'inbound', $4, now()::text, $5,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END,
       CASE WHEN $7::text IS NULL THEN NULL ELSE now() + $7::interval END)`,
    [id, tenantId, `tok_${id}`, status, abgehoben, geld, hoechstdauerLease],
  );
}

const zeile = async (tenantId, id) => {
  await kontext(tenantId);
  const { rows } = await db.query(
    `SELECT frist_geld_at AS geld, frist_geld_versuche::int AS versuche,
       frist_geld_lease_bis > now() + interval '50 seconds' AS lease_lang,
       frist_geld_lease_bis < now() + interval '70 seconds' AS lease_kurz,
       frist_lease_bis, frist_versuche::int AS hoechstdauer_versuche
     FROM call WHERE id = $1`,
    [id],
  );
  return rows[0];
};

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Geld-Frist: findet faellige aktive Anrufe aller Mandanten, nicht beendete und nicht kuenftige", async () => {
  await anruf(A, "g_a_faellig", { geld: "-1 minute" });
  await anruf(B, "g_b_faellig", { geld: "-2 hours" });
  await anruf(A, "g_a_beendet", { geld: "-1 minute", status: "completed" });
  await anruf(A, "g_a_spaeter", { geld: "1 hour", abgehobenVorMs: 5 * MINUTE_MS });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), ["g_a_faellig", "g_b_faellig"]);
  const b = treffer.find((eintrag) => eintrag.callId === "g_b_faellig");
  assert.equal(b.tenantId, B);
  assert.equal(b.versuche, 1);
  assert.ok(Date.parse(b.faelligAt) < Date.now() - 3_600_000);
});

test("Geld-Frist: ein abgehobener Anruf ohne Geld-Frist ist sofort faellig, ein nie abgehobener nicht", async () => {
  await anruf(A, "g_alt_abgehoben", { abgehobenVorMs: MINUTE_MS });
  await anruf(A, "g_alt_klingelt");
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes("g_alt_abgehoben"));
  assert.ok(!treffer.includes("g_alt_klingelt"));
});

test("Geld-Frist: eine gesetzte Frist in der Zukunft gilt vor dem Abhebe-Zeitpunkt", async () => {
  await anruf(B, "g_frist_gilt", { geld: "1 hour", abgehobenVorMs: 3 * 60 * MINUTE_MS });
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes("g_frist_gilt"));
});

test("Geld-Frist: das Holen setzt eine eigene Lease und zaehlt einen Versuch, die Hoechstdauer-Spalten bleiben unberuehrt", async () => {
  await anruf(A, "g_lease", { geld: "-1 minute" });
  assert.deepEqual(ids(await speicher.faelligeFristen(ANFRAGE)).filter((id) => id === "g_lease"), ["g_lease"]);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes("g_lease"));
  const nach = await zeile(A, "g_lease");
  assert.equal(nach.versuche, 1);
  assert.equal(nach.lease_lang, true);
  assert.equal(nach.lease_kurz, true);
  assert.equal(nach.frist_lease_bis, null);
  assert.equal(nach.hoechstdauer_versuche, 0);
  await kontext(A);
  await db.query("UPDATE call SET frist_geld_lease_bis = now() - interval '1 second' WHERE id = 'g_lease'");
  const wieder = (await speicher.faelligeFristen(ANFRAGE)).find((eintrag) => eintrag.callId === "g_lease");
  assert.equal(wieder.versuche, 2);
});

test("Geld-Frist: eine Hoechstdauer-Lease sperrt die Geld-Frist nicht", async () => {
  await anruf(A, "g_fremde_lease", { geld: "-1 minute", hoechstdauerLease: "1 hour" });
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes("g_fremde_lease"));
});

test("Geld-Frist: das Limit gilt je Mandant, der aelteste Anruf kommt zuerst", async () => {
  await anruf(A, "gl_a_alt", { geld: "-3 hours" });
  await anruf(A, "gl_a_neu", { geld: "-1 hour" });
  await anruf(B, "gl_b_alt", { geld: "-3 hours" });
  await anruf(B, "gl_b_neu", { geld: "-1 hour" });
  const treffer = ids(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((id) => id.startsWith("gl_"));
  assert.deepEqual(treffer, ["gl_a_alt", "gl_b_alt"]);
});

test("Geld-Frist schreiben: setzt die naechste Pruefung auf genau den Zeitpunkt und setzt die Versuche zurueck", async () => {
  await anruf(A, "gs_aktiv", { geld: "-1 minute" });
  await speicher.faelligeFristen(ANFRAGE);
  assert.equal((await zeile(A, "gs_aktiv")).versuche, 1);
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeGeldFrist({ callId: "gs_aktiv", tenantId: A, faelligAt });
  const nach = await zeile(A, "gs_aktiv");
  assert.equal(nach.geld.toISOString(), faelligAt);
  assert.equal(nach.versuche, 0);
});

test("Geld-Frist schreiben: ein beendeter Anruf und der Anruf eines anderen Mandanten bleiben unveraendert", async () => {
  await anruf(A, "gs_beendet", { status: "completed" });
  await anruf(B, "gs_fremd");
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeGeldFrist({ callId: "gs_beendet", tenantId: A, faelligAt });
  await speicher.setzeGeldFrist({ callId: "gs_fremd", tenantId: A, faelligAt });
  assert.equal((await zeile(A, "gs_beendet")).geld, null);
  assert.equal((await zeile(B, "gs_fremd")).geld, null);
});

test("Geld-Frist schreiben: ein Anruf, dessen Zeile noch im ausstehenden Schreiben steht, bekommt die Frist trotzdem", async () => {
  await speicher.zustandNachladen();
  const call = speicher.createCall({ direction: "inbound", from: "+4915112340002", to: "+4930555000302", goal: "Geld", tenantId: A });
  speicher.markAnswered(call.id);
  const faelligAt = "2032-01-02T03:04:05.000Z";
  await speicher.setzeGeldFrist({ callId: call.id, tenantId: A, faelligAt });
  await speicher.drainFlushes();
  assert.equal((await zeile(A, call.id)).geld.toISOString(), faelligAt);
});
