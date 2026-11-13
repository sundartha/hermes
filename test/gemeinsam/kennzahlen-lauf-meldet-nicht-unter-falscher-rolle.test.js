import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const WERT = { richtung: "outbound", ergebnis: "angenommen" };

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  unterKennzahlenLeser: true,
  kennzahlenAdresse: "postgres://kennzahlen-leser-attrappe.invalid/hermes",
  ohneStartanruf: true,
});

await anrufEinfuegen(laufendesHermes().db, {
  status: "completed",
  started_at: zeitpunkt(0, "09:00:00"),
  answered_at: zeitpunkt(0, "09:01:00"),
  ended_at: zeitpunkt(0, "09:05:00"),
});

async function alsBetreiber(sql) {
  await laufendesHermes().db.exec(`RESET ROLE; ${sql}; SET ROLE kv2_app;`);
}

async function datenbankName() {
  const { rows } = await laufendesHermes().db.query("SELECT current_database() AS name");
  return rows[0].name;
}

const FAELLE = [
  { kennung: "S23", titel: "die Leserolle transcript_segment lesen darf", an: () => `GRANT SELECT ON transcript_segment TO ${ROLLE}`, aus: () => `REVOKE ALL ON transcript_segment FROM ${ROLLE}` },
  { kennung: "S24", titel: "die Leserolle Mitglied einer anderen Rolle ist", an: () => `CREATE ROLE kennzahlen_fremd; GRANT kennzahlen_fremd TO ${ROLLE}`, aus: () => `DROP ROLE kennzahlen_fremd` },
  { kennung: "S25", titel: "die Leserolle keine Verbindungsgrenze hat", an: () => `ALTER ROLE ${ROLLE} CONNECTION LIMIT -1`, aus: () => `ALTER ROLE ${ROLLE} CONNECTION LIMIT 2` },
  { kennung: "S26", titel: "die Leserolle in public anlegen darf", an: () => `GRANT CREATE ON SCHEMA public TO ${ROLLE}`, aus: () => `REVOKE CREATE ON SCHEMA public FROM ${ROLLE}` },
  { kennung: "S30", titel: "die Leserolle account.email lesen darf", an: () => `GRANT SELECT (email) ON account TO ${ROLLE}`, aus: () => `REVOKE ALL (email) ON account FROM ${ROLLE}` },
  { kennung: "S31", titel: "PUBLIC transcript_segment lesen darf", an: () => "GRANT SELECT ON transcript_segment TO PUBLIC", aus: () => "REVOKE ALL ON transcript_segment FROM PUBLIC" },
  { kennung: "S32", titel: "die Leserolle Schemas anlegen darf", an: (name) => `GRANT CREATE ON DATABASE "${name}" TO ${ROLLE}`, aus: (name) => `REVOKE CREATE ON DATABASE "${name}" FROM ${ROLLE}` },
  { kennung: "S33", titel: "die Leserolle BYPASSRLS hat", an: () => `ALTER ROLE ${ROLLE} BYPASSRLS`, aus: () => `ALTER ROLE ${ROLLE} NOBYPASSRLS` },
  { kennung: "S34", titel: "die Leserolle Superuser ist", an: () => `ALTER ROLE ${ROLLE} SUPERUSER`, aus: () => `ALTER ROLE ${ROLLE} NOSUPERUSER` },
];

async function takt() {
  const store = await import("../../src/store.js");
  const zeilen = [];
  mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await store.kennzahlenTakt();
  mock.restoreAll();
  return { momentaufnahme: store.kennzahlenMomentaufnahme(), zeilen };
}

test("S-Eingerichtet: mit der eingerichteten Rolle meldet der Lauf anrufe_heute outbound angenommen = 1", async () => {
  const { momentaufnahme, zeilen } = await takt();
  assert.equal(wertVon(momentaufnahme, "anrufe_heute", WERT), 1);
  assert.deepEqual(zeilen, []);
});

for (const fall of FAELLE) {
  test(`${fall.kennung}: ${fall.titel}, meldet der Lauf nichts, und nach dem Entzug wieder`, async () => {
    const name = await datenbankName();
    await alsBetreiber(fall.an(name));
    try {
      const verletzt = await takt();
      assert.equal(verletzt.momentaufnahme, null);
      assert.deepEqual(verletzt.zeilen, ["[kennzahlen] Lauf fehlgeschlagen: KENNZAHLEN_ROLLE"]);
    } finally {
      await alsBetreiber(fall.aus(name));
    }
    const danach = await takt();
    assert.equal(wertVon(danach.momentaufnahme, "anrufe_heute", WERT), 1);
  });
}

test("Takt: die Prüfung gilt für jeden Takt, auch wenn der erste bestand", async () => {
  assert.equal(wertVon((await takt()).momentaufnahme, "anrufe_heute", WERT), 1);
  await alsBetreiber(`GRANT SELECT ON transcript_segment TO ${ROLLE}`);
  try {
    assert.equal((await takt()).momentaufnahme, null);
  } finally {
    await alsBetreiber(`REVOKE ALL ON transcript_segment FROM ${ROLLE}`);
  }
});
