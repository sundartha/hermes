import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const ADRESSE = "postgres://kennzahlen-leser-attrappe.invalid/hermes";
const ANGENOMMEN = { richtung: "outbound", ergebnis: "angenommen" };

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

async function inMandant(db, tenantId, arbeit) {
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await arbeit(transaktion);
  });
}

test("S14: nach dem Löschen der Daten von Kunde A steht anrufe_heute outbound angenommen im nächsten Lauf auf 0", async () => {
  const { db } = laufendesHermes();
  const tenantId = "tenant_kunde_a";
  await db.query("INSERT INTO tenant (id, status) VALUES ($1, 'active')", [tenantId]);
  await inMandant(db, tenantId, (transaktion) =>
    transaktion.query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, ended_at)
       VALUES ('call_kunde_a', $1, 'kennzahlen-test', 'outbound', 'completed', $2, $3, $4)`,
      [tenantId, zeitpunkt(0, "09:00:00"), zeitpunkt(0, "09:01:00"), zeitpunkt(0, "09:05:00")],
    ),
  );
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  assert.equal(wertVon(store.kennzahlenMomentaufnahme(), "anrufe_heute", ANGENOMMEN), 1);

  await inMandant(db, tenantId, (transaktion) => transaktion.query("DELETE FROM call WHERE tenant_id = $1", [tenantId]));
  await store.kennzahlenTakt();
  assert.equal(wertVon(store.kennzahlenMomentaufnahme(), "anrufe_heute", ANGENOMMEN), 0);
});
