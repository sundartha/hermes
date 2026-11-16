import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_fr_a";
const B = "t_fr_b";
const LEASE_MS = 60_000;
const ANFRAGE = { art: "hoechstdauer", limitJeMandant: 10, leaseMs: LEASE_MS };

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { pgliteAlsRolleOhneSuperuser } = await import("../pg-helpers.js");
const { poolAufPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const db = await pgliteAlsRolleOhneSuperuser();
poolAufPglite(db);
const speicher = await import("../../src/store.js").then(oeffneSpeicherAn);

const kontext = (tenantId) => db.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
const kontextLeeren = () => kontext("");

for (const id of [A, B]) {
  await kontext(id);
  await db.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [id]);
}
await kontextLeeren();

async function anruf(tenantId, id, { status = "active", frist = "-1 minute", lease = null } = {}) {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, frist_hoechstdauer_at, frist_lease_bis)
     VALUES ($1, $2, $3, 'outbound', $4, now()::text,
       CASE WHEN $5::text IS NULL THEN NULL ELSE now() + $5::interval END,
       CASE WHEN $6::text IS NULL THEN NULL ELSE now() + $6::interval END)`,
    [id, tenantId, `tok_${id}`, status, frist, lease],
  );
  await kontextLeeren();
}

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Fristen: findet faellige aktive Anrufe aller Mandanten, nicht beendete, nicht kuenftige, nicht fristlose", async () => {
  await anruf(A, "a_faellig");
  await anruf(B, "b_faellig", { frist: "-2 hours" });
  await anruf(A, "a_beendet", { status: "completed" });
  await anruf(A, "a_spaeter", { frist: "1 hour" });
  await anruf(B, "b_ohne", { frist: null });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(treffer), ["a_faellig", "b_faellig"]);
  const b = treffer.find((eintrag) => eintrag.callId === "b_faellig");
  assert.equal(b.tenantId, B);
  assert.equal(b.versuche, 1);
  assert.ok(Date.parse(b.faelligAt) < Date.now() - 3_600_000);
});

test("Fristen: der Lauf laesst keinen Mandanten-Kontext in der Sitzung stehen", async () => {
  await anruf(A, "a_kontext");
  await speicher.faelligeFristen(ANFRAGE);
  const { rows } = await db.query("SELECT current_setting('app.current_tenant', true) AS k");
  assert.ok(!rows[0].k);
});

test("Fristen: ein geholter Anruf ist bis zum Ende der Lease nicht mehr faellig, danach wieder, mit gezaehltem Versuch", async () => {
  await anruf(A, "a_lease");
  const erster = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(ids(erster).filter((id) => id === "a_lease"), ["a_lease"]);
  const zweiter = await speicher.faelligeFristen(ANFRAGE);
  assert.ok(!ids(zweiter).includes("a_lease"));
  await kontext(A);
  const lease = await db.query("SELECT frist_lease_bis > now() + interval '50 seconds' AS lang, frist_lease_bis < now() + interval '70 seconds' AS kurz FROM call WHERE id = 'a_lease'");
  assert.deepEqual(lease.rows, [{ lang: true, kurz: true }]);
  await db.query("UPDATE call SET frist_lease_bis = now() - interval '1 second' WHERE id = 'a_lease'");
  await kontextLeeren();
  const dritter = (await speicher.faelligeFristen(ANFRAGE)).find((eintrag) => eintrag.callId === "a_lease");
  assert.equal(dritter.versuche, 2);
});

test("Fristen: eine Lease in der Zukunft sperrt, eine abgelaufene nicht", async () => {
  await anruf(A, "a_fremde_lease", { lease: "1 hour" });
  await anruf(A, "a_alte_lease", { lease: "-1 hour" });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(!treffer.includes("a_fremde_lease"));
  assert.ok(treffer.includes("a_alte_lease"));
});

test("Fristen: das Limit gilt je Mandant, der aelteste Anruf kommt zuerst", async () => {
  await anruf(A, "l_a_alt", { frist: "-3 hours" });
  await anruf(A, "l_a_neu", { frist: "-1 hour" });
  await anruf(B, "l_b_alt", { frist: "-3 hours" });
  await anruf(B, "l_b_neu", { frist: "-1 hour" });
  const treffer = ids(await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 1 })).filter((id) => id.startsWith("l_"));
  assert.deepEqual(treffer, ["l_a_alt", "l_b_alt"]);
});

test("Fristen: eine unbekannte Art wirft", async () => {
  await assert.rejects(speicher.faelligeFristen({ ...ANFRAGE, art: "unbekannt" }), /unbekannte Frist: unbekannt/);
});

test("Fristen: ein Lesefehler wirft und steht im Log, der naechste Lauf geht danach wieder", async (t) => {
  await anruf(A, "f_kaputt");
  await db.exec(`CREATE FUNCTION fr_fehler() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'schreiben verweigert'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER fr_fehler BEFORE UPDATE ON call FOR EACH ROW WHEN (NEW.id = 'f_kaputt') EXECUTE FUNCTION fr_fehler();`);
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await assert.rejects(speicher.faelligeFristen(ANFRAGE), /schreiben verweigert/);
  assert.ok(zeilen.some((zeile) => zeile.includes("[fristen] faellige Fristen lesen fehlgeschlagen: schreiben verweigert")));
  await db.exec("DROP TRIGGER fr_fehler ON call");
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.ok(ids(treffer).includes("f_kaputt"));
});
