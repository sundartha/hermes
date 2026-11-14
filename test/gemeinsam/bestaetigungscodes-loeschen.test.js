import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank } from "./echtes-postgres.js";
import { mitGestartetemHermes } from "./pg-start-umgebung.js";
import { vorgaengerStarten } from "./vorgaenger.js";
import { anfrage } from "./zwei-prozesse.js";

const HTTP_OK = 200;
const ZEITGRENZE_MS = 180_000;
const MANDANT = "mandant-bestaetigung-loeschen";
const GELOESCHT = ["bestaetigung_slot", "bestaetigung_verbrauch"];
const ALTE_TABELLEN = GELOESCHT.map(
  (name) => `
  CREATE TABLE ${name} (
    tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    digest TEXT NOT NULL,
    slot BIGINT NOT NULL DEFAULT 0,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, digest)
  );
  ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${name} FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON ${name}
    USING (tenant_id = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));`,
).join("\n");
const CHECKSUMME_0003 = "16c4d380b705736391b1f359241927b72de3c7e7814c2d1a759193d2bb9fd767";
const POLICY_ANZAHL_NACH_0010 = 15;
const POLICY_ANZAHL_VOR_0010 = 17;

function starten(adresse) {
  return mitGestartetemHermes(
    adresse,
    { HERMES_DEPLOY_TOKEN: "bestaetigung-loeschen-deploy-token-mindestens-32" },
    async (prozess) => (await abrufMitFrist(`${prozess.localUrl}/healthz`)).status,
  );
}

async function vorhanden(verbindung, name) {
  const { rows } = await verbindung.query("SELECT to_regclass($1)::text AS tabelle", [name]);
  return rows[0].tabelle;
}

async function tabellen(verbindung) {
  const { rows } = await verbindung.query(
    `SELECT relname FROM pg_class
      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace ORDER BY relname`,
  );
  return rows.map((zeile) => zeile.relname);
}

async function richtlinien(verbindung) {
  const { rows } = await verbindung.query(
    "SELECT count(*)::int AS anzahl FROM pg_policies WHERE policyname = 'tenant_isolation'",
  );
  return rows[0].anzahl;
}

async function migrationen(verbindung) {
  const { rows } = await verbindung.query(
    "SELECT version::text AS version, name, checksum FROM schema_migrations ORDER BY schema_migrations.version",
  );
  return rows;
}

async function stand0009Herstellen(verbindung) {
  await verbindung.query(ALTE_TABELLEN);
  await verbindung.query("DELETE FROM schema_migrations WHERE version = 10");
  await verbindung.query("INSERT INTO tenant (id) VALUES ($1)", [MANDANT]);
  await verbindung.query("BEGIN");
  await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [MANDANT]);
  await verbindung.query(
    "INSERT INTO bestaetigung_verbrauch (tenant_id, digest, expires_at) VALUES ($1, 'd', 1)",
    [MANDANT],
  );
  await verbindung.query(
    "INSERT INTO bestaetigung_slot (tenant_id, digest, slot, expires_at) VALUES ($1, 'd', 1, 1)",
    [MANDANT],
  );
  await verbindung.query("COMMIT");
}

async function gestarteteDatenbank(t) {
  const db = await echteDatenbank(t);
  if (!db) return null;
  assert.equal(await starten(db.adresse), HTTP_OK);
  return { db, verbindung: await db.verbinden() };
}

test(
  "Abnahme 1: leere Datenbank, beide Bestätigungstabellen fehlen und Version 10 ist eingetragen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const bereit = await gestarteteDatenbank(t);
    if (!bereit) return;
    for (const name of GELOESCHT) assert.equal(await vorhanden(bereit.verbindung, name), null);
    const zeilen = await migrationen(bereit.verbindung);
    const zehn = zeilen.find((zeile) => zeile.version === "10");
    assert.equal(zehn?.name, "0010_bestaetigungscodes_loeschen");
  },
);

test(
  "Abnahme 2 und 5: Stand 0009 mit Zeilen startet, nur die zwei Tabellen verschwinden, 14 Richtlinien bleiben",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const bereit = await gestarteteDatenbank(t);
    if (!bereit) return;
    const { db, verbindung } = bereit;
    const nachher = await tabellen(verbindung);
    await stand0009Herstellen(verbindung);
    const vorher = await tabellen(verbindung);
    assert.equal(await richtlinien(verbindung), POLICY_ANZAHL_VOR_0010);
    assert.equal(await starten(db.adresse), HTTP_OK);
    const danach = await tabellen(verbindung);
    assert.deepEqual(vorher.filter((name) => !danach.includes(name)), GELOESCHT);
    assert.deepEqual(danach, nachher);
    assert.ok(danach.includes("bestaetigung_fehlversuch"));
    assert.equal(await richtlinien(verbindung), POLICY_ANZAHL_NACH_0010);
  },
);

test(
  "Abnahme 3: zweiter Start ändert nichts, fehlender Eintrag 10 wird ohne Fehler nachgetragen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const bereit = await gestarteteDatenbank(t);
    if (!bereit) return;
    const { db, verbindung } = bereit;
    const erste = await migrationen(verbindung);
    assert.equal(await starten(db.adresse), HTTP_OK);
    assert.deepEqual(await migrationen(verbindung), erste);
    await verbindung.query("DELETE FROM schema_migrations WHERE version = 10");
    assert.equal(await starten(db.adresse), HTTP_OK);
    assert.deepEqual(await migrationen(verbindung), erste);
  },
);

test(
  "Abnahme 4: die Version vor diesem PR startet gegen das Schema nach 0010",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const bereit = await gestarteteDatenbank(t);
    if (!bereit) return;
    const vorgaenger = await vorgaengerStarten(t, { adresse: bereit.db.adresse, env: {} });
    assert.equal((await anfrage(vorgaenger, "/healthz")).status, HTTP_OK);
  },
);

test(
  "Abnahme 6: die gespeicherte Prüfsumme von Version 3 ist die der unveränderten Datei",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const bereit = await gestarteteDatenbank(t);
    if (!bereit) return;
    const drei = (await migrationen(bereit.verbindung)).find((zeile) => zeile.version === "3");
    assert.equal(drei.checksum, CHECKSUMME_0003);
  },
);
