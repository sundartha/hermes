import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const ADRESSE = "postgres://kennzahlen-leser-attrappe.invalid/hermes";

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  unterKennzahlenLeser: true,
  kennzahlenAdresse: ADRESSE,
  ohneStartanruf: true,
});

async function beantwortetenAnrufFuerNeuenKunden(db, kennung) {
  const tenantId = `tenant_${kennung}`;
  await db.query("INSERT INTO tenant (id, status) VALUES ($1, 'active')", [tenantId]);
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await transaktion.query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, ended_at)
       VALUES ($1, $2, 'kennzahlen-test', 'outbound', 'completed', $3, $4, $5)`,
      [`call_${kennung}`, tenantId, zeitpunkt(0, "09:00:00"), zeitpunkt(0, "09:01:00"), zeitpunkt(0, "09:05:00")],
    );
  });
}

test("S13: die Leserolle ohne BYPASSRLS zählt die Anrufe zweier Kunden zusammen", async () => {
  const { db } = laufendesHermes();
  const rolle = await db.query("SELECT rolbypassrls FROM pg_roles WHERE rolname = $1", [ROLLE]);
  assert.equal(rolle.rows[0].rolbypassrls, false);
  await beantwortetenAnrufFuerNeuenKunden(db, "kunde_a");
  await beantwortetenAnrufFuerNeuenKunden(db, "kunde_b");
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  const zeilen = store.kennzahlenMomentaufnahme();
  assert.equal(wertVon(zeilen, "anrufe_heute", { richtung: "outbound", ergebnis: "angenommen" }), 2);
});
