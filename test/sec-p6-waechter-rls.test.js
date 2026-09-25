// SEC-P6, Waechter 1: das RLS-Inventar.
//
// Zusage: JEDE Tabelle mit Spalte tenant_id traegt Row-Level-Security als FORCE plus
// mindestens eine Policy - ODER sie steht mit Begruendung in der hartkodierten
// Ausnahmeliste unten. Der Waechter friert den heute erreichten Stand ein: eine neue
// Tabelle mit tenant_id, die niemand mit einer Policy versieht, macht rot, statt still
// jedem Tenant die Zeilen aller anderen zu zeigen.
//
// Naht wie test/rls-with-check.test.js: frische pglite-Instanz, Schema als Superuser
// angewendet, danach reine Katalog-Abfragen (pg_class/pg_policies). Offline, kein Spawn,
// kein Netz.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests) - ein Waechter, der nicht im Regressionslauf faehrt,
// friert nichts ein.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";

// Die drei Tabellen, die tenant_id tragen und trotzdem KEINE Policy haben duerfen. Jede
// mit ihrem Grund - eine Liste ohne Begruendung waere eine Blankovollmacht.
const RLS_AUSNAHMEN = Object.freeze({
  account: "identity(sub)->tenant-Resolver, laeuft VOR app.current_tenant (schema.sql)",
  session: "Sitzungs-Aufloesung, laeuft VOR app.current_tenant",
  audit_log:
    "append-only, privilegierter Insert-Pfad; laut schema.sql NIE ueber " +
    "portalStore/Kunden-Reads exponiert",
});

// Jede public-Tabelle mit Spalte tenant_id samt ihrem RLS-Zustand. EINE Abfrage, EINE
// Quelle - beide Waechter-Tests und die Positiv-Kontrolle lesen dasselbe Inventar.
async function rlsInventar(db) {
  const { rows } = await db.query(`
    SELECT c.relname AS tabelle,
           c.relrowsecurity AS enabled,
           c.relforcerowsecurity AS forced,
           (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public'
                      AND col.table_name = c.relname
                      AND col.column_name = 'tenant_id')
     ORDER BY c.relname`);
  return rows.map((zeile) => ({
    tabelle: zeile.tabelle,
    enabled: zeile.enabled === true,
    forced: zeile.forced === true,
    policies: Number(zeile.policies),
  }));
}

const abgeschirmt = (eintrag) => eintrag.enabled && eintrag.forced && eintrag.policies > 0;

// Frische, rein im Hauptspeicher lebende Instanz je Aufruf. Sie wird nie geteilt: es gibt
// strukturell nichts aufzuraeumen, auch nicht wenn ein Test scheitert (besser als ein
// try/finally, das man vergessen kann).
async function schemaInventar() {
  const db = new PGlite();
  await applySchema({ query: (text, parameter) => db.query(text, parameter), exec: (sql) => db.exec(sql) });
  return { db, inventar: await rlsInventar(db) };
}

test("SEC-P6-7: jede Tabelle mit tenant_id hat FORCE + Policy oder steht begruendet in der Ausnahmeliste", async () => {
  const { inventar } = await schemaInventar();
  assert.ok(inventar.length > 0, "das Inventar ist leer - die Abfrage misst nichts");
  const ungeschuetzt = inventar
    .filter((eintrag) => !abgeschirmt(eintrag) && !(eintrag.tabelle in RLS_AUSNAHMEN))
    .map((eintrag) => `${eintrag.tabelle} (enabled=${eintrag.enabled} forced=${eintrag.forced} policies=${eintrag.policies})`);
  assert.deepEqual(
    ungeschuetzt,
    [],
    "Tabellen mit tenant_id ohne FORCE+Policy und ohne begruendete Ausnahme",
  );
});

test("SEC-P6-8: keine Ausnahme ist verwaist", async () => {
  const { inventar } = await schemaInventar();
  const namen = new Set(inventar.map((eintrag) => eintrag.tabelle));
  for (const [tabelle, grund] of Object.entries(RLS_AUSNAHMEN)) {
    assert.ok(namen.has(tabelle), `Ausnahme ${tabelle} existiert nicht mehr (${grund})`);
    const gefunden = inventar.find((eintrag) => eintrag.tabelle === tabelle);
    assert.ok(
      !abgeschirmt(gefunden),
      `${tabelle} hat inzwischen FORCE+Policy - die Ausnahme MUSS raus, sonst rottet die ` +
        "Liste zur Blankovollmacht",
    );
  }
});

test("SEC-P6-9 Positiv-Kontrolle: eine Sonde ohne Policy macht rot", async () => {
  const { db, inventar } = await schemaInventar();
  assert.ok(
    !inventar.some((eintrag) => eintrag.tabelle === "probe_leak"),
    "die Sonde existiert schon vor ihrer Anlage",
  );
  await db.exec(`CREATE TABLE probe_leak (tenant_id text)`);
  const befund = (await rlsInventar(db)).find((eintrag) => eintrag.tabelle === "probe_leak");
  assert.ok(befund, "die Sonde taucht im Inventar gar nicht auf - der Waechter sucht nichts");
  assert.equal(abgeschirmt(befund), false, "die Sonde gilt faelschlich als abgeschirmt");
  assert.equal(
    "probe_leak" in RLS_AUSNAHMEN,
    false,
    "die Sonde stuende in der Ausnahmeliste - sie wuerde nicht rot machen",
  );
});
