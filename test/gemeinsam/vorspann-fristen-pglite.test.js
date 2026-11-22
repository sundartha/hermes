import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_vf_a";
const B = "t_vf_b";
const LEASE_MS = 60_000;
const VERGANGEN = "2020-01-01T00:00:00.000Z";
const ANFRAGE = { art: "vorspann", limitJeMandant: 10, leaseMs: LEASE_MS };

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

async function zeileAnlegen(tenantId, callId, fristen = {}) {
  await kontext(tenantId);
  await db.query(
    `INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at, frist_klingel_at, frist_wiedergabe_at, frist_el_bein_at)
     VALUES ($1, $2, 'tok', 'satz', now() + interval '1 hour',
       now() + $3::interval, now() + $4::interval, now() + $5::interval)`,
    [callId, tenantId, fristen.klingel ?? null, fristen.wiedergabe ?? null, fristen.elBein ?? null],
  );
}

const zeile = async (tenantId, callId) => {
  await kontext(tenantId);
  const { rows } = await db.query(
    `SELECT frist_klingel_at AS klingel, frist_wiedergabe_at AS wiedergabe, frist_el_bein_at AS el_bein,
       frist_klingel_versuche::int AS k_versuche, frist_wiedergabe_versuche::int AS w_versuche, frist_el_bein_versuche::int AS e_versuche,
       frist_wiedergabe_lease_bis > now() + interval '50 seconds' AS w_lease_lang,
       frist_wiedergabe_lease_bis < now() + interval '70 seconds' AS w_lease_kurz,
       frist_klingel_lease_bis IS NULL AS k_ohne_lease
     FROM vorspann_zustand WHERE call_id = $1`,
    [callId],
  );
  return rows[0];
};

const kurz = (treffer) => treffer.map((eintrag) => `${eintrag.callId}:${eintrag.frist}`).sort();

test("Vorspann-Fristen: faellige Fristen aller Mandanten mit Art der Frist, nicht kuenftige, nicht gesetzte", async () => {
  await zeileAnlegen(A, "v_a", { klingel: "-1 minute", wiedergabe: "1 hour" });
  await zeileAnlegen(B, "v_b", { wiedergabe: "-2 hours", elBein: "-1 second" });
  await zeileAnlegen(A, "v_ohne");
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.deepEqual(kurz(treffer), ["v_a:klingel", "v_b:elBein", "v_b:wiedergabe"]);
  const b = treffer.find((eintrag) => eintrag.callId === "v_b" && eintrag.frist === "wiedergabe");
  assert.equal(b.tenantId, B);
  assert.equal(b.versuche, 1);
  assert.equal(b.faelligAt, (await zeile(B, "v_b")).wiedergabe.toISOString());
  assert.ok(Date.parse(b.faelligAt) < Date.parse(treffer.find((eintrag) => eintrag.frist === "elBein").faelligAt));
});

test("Vorspann-Fristen: die zweite Instanz bekommt eine geleaste Frist nicht, nur die geholte Frist zaehlt einen Versuch, nach Lease-Ablauf kommt sie wieder", async () => {
  await zeileAnlegen(A, "v_lease", { klingel: "-1 minute", wiedergabe: "-1 minute" });
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE)).filter((s) => s.startsWith("v_lease")), ["v_lease:klingel", "v_lease:wiedergabe"]);
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE)).filter((s) => s.startsWith("v_lease")), []);
  const nach = await zeile(A, "v_lease");
  assert.equal(nach.k_versuche, 1);
  assert.equal(nach.w_versuche, 1);
  assert.equal(nach.e_versuche, 0);
  assert.equal(nach.w_lease_lang, true);
  assert.equal(nach.w_lease_kurz, true);
  await db.query("UPDATE vorspann_zustand SET frist_wiedergabe_lease_bis = now() - interval '1 second' WHERE call_id = 'v_lease'");
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE)).filter((s) => s.startsWith("v_lease")), ["v_lease:wiedergabe"]);
  assert.equal((await zeile(A, "v_lease")).w_versuche, 2);
});

test("Vorspann-Fristen: das Limit gilt je Mandant und Frist", async () => {
  for (const id of ["v_l1", "v_l2", "v_l3"]) await zeileAnlegen(A, id, { elBein: "-1 minute" });
  const treffer = await speicher.faelligeFristen({ ...ANFRAGE, limitJeMandant: 2 });
  assert.equal(treffer.filter((eintrag) => eintrag.callId.startsWith("v_l")).length, 2);
});

test("Vorspann-Fristen: setze stellt die Frist und setzt den Zaehler zurueck, leere macht sie nie wieder faellig, andere Fristen bleiben", async () => {
  await zeileAnlegen(A, "v_setze", { klingel: "-1 minute", elBein: "-1 minute" });
  await speicher.faelligeFristen(ANFRAGE);
  assert.equal((await zeile(A, "v_setze")).k_versuche, 1);
  await speicher.setzeVorspannFrist({ tenantId: A, callId: "v_setze", frist: "klingel", faelligAt: VERGANGEN });
  const gestellt = await zeile(A, "v_setze");
  assert.equal(gestellt.k_versuche, 0);
  assert.ok(gestellt.klingel);
  await speicher.leereVorspannFrist({ tenantId: A, callId: "v_setze", frist: "klingel" });
  const geleert = await zeile(A, "v_setze");
  assert.equal(geleert.klingel, null);
  assert.ok(geleert.el_bein);
  await db.query("UPDATE vorspann_zustand SET frist_klingel_lease_bis = NULL, frist_el_bein_lease_bis = NULL WHERE call_id = 'v_setze'");
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE)).filter((s) => s.startsWith("v_setze")), ["v_setze:elBein"]);
});

test("Vorspann-Fristen: setze fuer einen fremden Mandanten oder eine fehlende Zeile aendert nichts", async () => {
  await zeileAnlegen(A, "v_fremd");
  await speicher.setzeVorspannFrist({ tenantId: B, callId: "v_fremd", frist: "klingel", faelligAt: VERGANGEN });
  await speicher.setzeVorspannFrist({ tenantId: A, callId: "v_weg", frist: "klingel", faelligAt: VERGANGEN });
  assert.equal((await zeile(A, "v_fremd")).klingel, null);
  assert.deepEqual(kurz(await speicher.faelligeFristen(ANFRAGE)).filter((s) => s.startsWith("v_fremd") || s.startsWith("v_weg")), []);
});

test("Vorspann-Fristen: ein Lesefehler wirft statt eine leere Liste zu liefern", async () => {
  await db.query("ALTER TABLE vorspann_zustand RENAME COLUMN frist_el_bein_at TO frist_el_bein_kaputt");
  await assert.rejects(speicher.faelligeFristen(ANFRAGE));
  await db.query("ALTER TABLE vorspann_zustand RENAME COLUMN frist_el_bein_kaputt TO frist_el_bein_at");
});
