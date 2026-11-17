import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";

const A = "t_fab_a";
const B = "t_fab_b";
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

async function anruf(tenantId, id, { status = "active", abfrage = null, hoechstdauerLease = null } = {}) {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, frist_abfrage_at, frist_lease_bis)
     VALUES ($1, $2, $3, 'outbound', $4, now()::text,
       CASE WHEN $5::text IS NULL THEN NULL ELSE now() + $5::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END)`,
    [id, tenantId, `tok_${id}`, status, abfrage, hoechstdauerLease],
  );
}

const zeile = async (tenantId, id) => {
  await kontext(tenantId);
  const { rows } = await db.query(
    `SELECT frist_abfrage_at AS abfrage, frist_abfrage_versuche::int AS versuche,
       frist_abfrage_lease_bis > now() + interval '50 seconds' AS lease_lang,
       frist_abfrage_lease_bis < now() + interval '70 seconds' AS lease_kurz,
       frist_lease_bis, frist_geld_lease_bis, frist_reserve_lease_bis, frist_versuche::int AS hoechstdauer_versuche
     FROM call WHERE id = $1`,
    [id],
  );
  return rows[0];
};

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Abfrage-Frist: findet faellige aktive Anrufe aller Mandanten, nicht kuenftige, nicht ohne Frist und nicht beendete", async () => {
  await anruf(A, "ab_a_faellig", { abfrage: "-1 minute" });
  await anruf(B, "ab_b_faellig", { abfrage: "-2 hours" });
  await anruf(A, "ab_a_spaeter", { abfrage: "1 hour" });
  await anruf(A, "ab_a_ohne");
  await anruf(A, "ab_a_beendet", { abfrage: "-1 minute", status: "completed" });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), ["ab_a_faellig", "ab_b_faellig"]);
  const b = treffer.find((eintrag) => eintrag.callId === "ab_b_faellig");
  assert.equal(b.tenantId, B);
  assert.equal(b.versuche, 1);
  assert.ok(Date.parse(b.faelligAt) < Date.now() - 3_600_000);
});

test("Abfrage-Frist: das Holen setzt eine eigene Lease und zaehlt einen Versuch, die anderen Fristspalten bleiben unberuehrt", async () => {
  await anruf(A, "ab_lease", { abfrage: "-1 minute" });
  assert.deepEqual(ids(await speicher.faelligeFristen(ANFRAGE)).filter((id) => id === "ab_lease"), ["ab_lease"]);
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes("ab_lease"));
  const nach = await zeile(A, "ab_lease");
  assert.equal(nach.versuche, 1);
  assert.equal(nach.lease_lang, true);
  assert.equal(nach.lease_kurz, true);
  assert.equal(nach.frist_lease_bis, null);
  assert.equal(nach.frist_geld_lease_bis, null);
  assert.equal(nach.frist_reserve_lease_bis, null);
  assert.equal(nach.hoechstdauer_versuche, 0);
  await kontext(A);
  await db.query("UPDATE call SET frist_abfrage_lease_bis = now() - interval '1 second' WHERE id = 'ab_lease'");
  const wieder = (await speicher.faelligeFristen(ANFRAGE)).find((eintrag) => eintrag.callId === "ab_lease");
  assert.equal(wieder.versuche, 2);
});

test("Abfrage-Frist: eine Hoechstdauer-Lease sperrt die Abfrage nicht, und die anderen Arten finden die Zeile nicht", async () => {
  await anruf(A, "ab_fremde_lease", { abfrage: "-1 minute", hoechstdauerLease: "1 hour" });
  assert.ok(!ids(await speicher.faelligeFristen({ ...ANFRAGE, art: "reserve" })).includes("ab_fremde_lease"));
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes("ab_fremde_lease"));
});

test("Abfrage-Frist: das Limit gilt je Mandant, die aelteste Abfrage kommt zuerst", async () => {
  await anruf(A, "abl_a_alt", { abfrage: "-3 hours" });
  await anruf(A, "abl_a_neu", { abfrage: "-1 hour" });
  await anruf(B, "abl_b_alt", { abfrage: "-3 hours" });
  await anruf(B, "abl_b_neu", { abfrage: "-1 hour" });
  const treffer = ids(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((id) => id.startsWith("abl_"));
  assert.deepEqual(treffer, ["abl_a_alt", "abl_b_alt"]);
});

test("Abfrage-Frist schreiben: setzt die Frist eines aktiven Anrufs auf genau den Zeitpunkt und die Versuche zurueck, ein beendeter Anruf bleibt", async () => {
  await anruf(A, "abs_aktiv", { abfrage: "-1 minute" });
  await anruf(A, "abs_beendet", { abfrage: "-1 minute", status: "completed" });
  await speicher.faelligeFristen(ANFRAGE);
  assert.equal((await zeile(A, "abs_aktiv")).versuche, 1);
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeAbfrageFrist({ callId: "abs_aktiv", tenantId: A, faelligAt });
  await speicher.setzeAbfrageFrist({ callId: "abs_beendet", tenantId: A, faelligAt });
  const nach = await zeile(A, "abs_aktiv");
  assert.equal(nach.abfrage.toISOString(), faelligAt);
  assert.equal(nach.versuche, 0);
  assert.notEqual((await zeile(A, "abs_beendet")).abfrage.toISOString(), faelligAt);
});

test("Abfrage-Frist schreiben: null leert die Frist, der Anruf eines anderen Mandanten bleibt unveraendert", async () => {
  await anruf(A, "abs_leeren", { abfrage: "1 hour" });
  await anruf(B, "abs_fremd", { abfrage: "1 hour" });
  await speicher.setzeAbfrageFrist({ callId: "abs_leeren", tenantId: A, faelligAt: null });
  await speicher.setzeAbfrageFrist({ callId: "abs_fremd", tenantId: A, faelligAt: null });
  assert.equal((await zeile(A, "abs_leeren")).abfrage, null);
  assert.notEqual((await zeile(B, "abs_fremd")).abfrage, null);
});

test("Abfrage-Frist schreiben: ein Anruf, dessen Zeile noch im ausstehenden Schreiben steht, bekommt die Frist trotzdem", async () => {
  await speicher.zustandNachladen();
  const call = speicher.createCall({ direction: "outbound", from: "+4915112340002", to: "+4930555000302", goal: "Abfrage", tenantId: A });
  await speicher.markAnswered(call.id);
  const faelligAt = "2032-01-02T03:04:05.000Z";
  await speicher.setzeAbfrageFrist({ callId: call.id, tenantId: A, faelligAt });
  await speicher.drainFlushes();
  assert.equal((await zeile(A, call.id)).abfrage.toISOString(), faelligAt);
});

test("Abfrage-Frist nach Neustart: zwei Laeufe fragen einen faelligen Anruf zusammen nur einmal ab", async () => {
  await anruf(A, "abn_neustart", { abfrage: "-1 minute" });
  const abgefragt = [];
  const lauf = () =>
    makeFristenLauf({
      store: speicher,
      beende: async () => {},
      limitJeMandant: 10,
      leaseMs: LEASE_MS,
      abfrage: { poll: async (callId, tenantId) => abgefragt.push([callId, tenantId]) },
    });
  assert.deepEqual(await lauf().abfrageTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.deepEqual(await lauf().abfrageTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(abgefragt, [["abn_neustart", A]]);
});
