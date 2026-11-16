import { test } from "node:test";
import assert from "node:assert/strict";

import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const A = "t_fw_a";
const B = "t_fw_b";
const LEASE_MS = 60_000;
const MINUTE_MS = 60_000;
const SEKUNDE_MS = 1000;
const STANDARD_S = 1800;
const NEUN_STUNDEN_MS = 9 * 60 * MINUTE_MS;
const ANFRAGE = { art: "hoechstdauer", limitJeMandant: 10, leaseMs: LEASE_MS };

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

async function anruf(tenantId, id, { status = "active", frist = null, abgehobenVorMs = null, maxDurationS = null, abgehobenText = null } = {}) {
  await kontext(tenantId);
  const abgehoben = abgehobenText ?? (abgehobenVorMs === null ? null : new Date(Date.now() - abgehobenVorMs).toISOString());
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, max_duration_s, frist_hoechstdauer_at)
     VALUES ($1, $2, $3, 'outbound', $4, now()::text, $5, $6,
       CASE WHEN $7::text IS NULL THEN NULL ELSE now() + $7::interval END)`,
    [id, tenantId, `tok_${id}`, status, abgehoben, maxDurationS, frist],
  );
}

const fristVon = async (tenantId, id) => {
  await kontext(tenantId);
  const { rows } = await db.query("SELECT frist_hoechstdauer_at AS f FROM call WHERE id = $1", [id]);
  return rows[0].f;
};

const ids = (treffer) => treffer.map((eintrag) => eintrag.callId).sort();

test("Frist schreiben: setzt die Frist eines aktiven Anrufs auf genau den genannten Zeitpunkt", async () => {
  await anruf(A, "s_aktiv");
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeHoechstdauerFrist({ callId: "s_aktiv", tenantId: A, faelligAt });
  assert.equal((await fristVon(A, "s_aktiv")).toISOString(), faelligAt);
});

test("Frist schreiben: ein beendeter Anruf und der Anruf eines anderen Mandanten bleiben unveraendert", async () => {
  await anruf(A, "s_beendet", { status: "completed" });
  await anruf(B, "s_fremd");
  const faelligAt = "2031-05-06T07:08:09.000Z";
  await speicher.setzeHoechstdauerFrist({ callId: "s_beendet", tenantId: A, faelligAt });
  await speicher.setzeHoechstdauerFrist({ callId: "s_fremd", tenantId: A, faelligAt });
  assert.equal(await fristVon(A, "s_beendet"), null);
  assert.equal(await fristVon(B, "s_fremd"), null);
});

test("Frist schreiben: ein Schreibfehler wirft und laesst keinen Mandanten-Kontext in der Sitzung stehen", async () => {
  await anruf(A, "s_fehler");
  await db.exec(`CREATE FUNCTION fw_fehler() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'schreiben verweigert'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER fw_fehler BEFORE UPDATE ON call FOR EACH ROW WHEN (NEW.id = 's_fehler') EXECUTE FUNCTION fw_fehler();`);
  await assert.rejects(
    speicher.setzeHoechstdauerFrist({ callId: "s_fehler", tenantId: A, faelligAt: "2031-05-06T07:08:09.000Z" }),
    /schreiben verweigert/,
  );
  await db.exec("DROP TRIGGER fw_fehler ON call");
  await kontext("");
  const { rows } = await db.query("SELECT current_setting('app.current_tenant', true) AS k");
  assert.ok(!rows[0].k);
});

test("Altzeile: ohne Frist faellt ein Anruf nach Abheben plus eigener Hoechstdauer faellig, davor nicht", async () => {
  await anruf(A, "alt_faellig", { abgehobenVorMs: 2 * MINUTE_MS, maxDurationS: 60 });
  await anruf(A, "alt_noch_nicht", { abgehobenVorMs: 30 * SEKUNDE_MS, maxDurationS: 60 });
  const treffer = await speicher.faelligeFristen(ANFRAGE);
  assert.ok(ids(treffer).includes("alt_faellig"));
  assert.ok(!ids(treffer).includes("alt_noch_nicht"));
  const gefunden = treffer.find((eintrag) => eintrag.callId === "alt_faellig");
  assert.equal(gefunden.versuche, 1);
  await kontext(A);
  const { rows } = await db.query("SELECT answered_at FROM call WHERE id = 'alt_faellig'");
  assert.equal(Date.parse(gefunden.faelligAt), Date.parse(rows[0].answered_at) + 60 * SEKUNDE_MS);
});

test("Altzeile: ohne eigene Hoechstdauer gilt die Kappung von 1800 Sekunden", async () => {
  await anruf(B, "alt_kappe_faellig", { abgehobenVorMs: (STANDARD_S + 60) * SEKUNDE_MS });
  await anruf(B, "alt_kappe_offen", { abgehobenVorMs: (STANDARD_S - 60) * SEKUNDE_MS });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes("alt_kappe_faellig"));
  assert.ok(!treffer.includes("alt_kappe_offen"));
});

test("Altzeile: der Abhebe-Zeitstempel wird als Zeitpunkt gelesen, nicht als Text, auch mit Zeitzonen-Versatz", async () => {
  const abgehobenVor = (STANDARD_S + 60) * SEKUNDE_MS;
  const versetzt = new Date(Date.now() - abgehobenVor + NEUN_STUNDEN_MS).toISOString().replace("Z", "+09:00");
  await anruf(A, "alt_versatz_faellig", { abgehobenText: versetzt });
  const jungVersetzt = new Date(Date.now() - 60 * SEKUNDE_MS + NEUN_STUNDEN_MS).toISOString().replace("Z", "+09:00");
  await anruf(A, "alt_versatz_offen", { abgehobenText: jungVersetzt });
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(treffer.includes("alt_versatz_faellig"));
  assert.ok(!treffer.includes("alt_versatz_offen"));
});

test("Altzeile: eine gesetzte Frist in der Zukunft gilt vor dem Abhebe-Zeitpunkt, ohne Abheben und ohne Frist ist nichts faellig", async () => {
  await anruf(A, "alt_frist_gilt", { abgehobenVorMs: 3 * 60 * MINUTE_MS, frist: "1 hour" });
  await anruf(A, "alt_nie_abgehoben");
  const treffer = ids(await speicher.faelligeFristen(ANFRAGE));
  assert.ok(!treffer.includes("alt_frist_gilt"));
  assert.ok(!treffer.includes("alt_nie_abgehoben"));
});

test("Altzeile: eine abgelaufene Altzeile wird nur einmal je Lease geholt", async () => {
  await anruf(A, "alt_lease", { abgehobenVorMs: 3 * 60 * MINUTE_MS });
  assert.ok(ids(await speicher.faelligeFristen(ANFRAGE)).includes("alt_lease"));
  assert.ok(!ids(await speicher.faelligeFristen(ANFRAGE)).includes("alt_lease"));
});
