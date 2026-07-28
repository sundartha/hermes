#!/usr/bin/env node
// AL-P1: read-only Lesezugang zum Prod-Store fuer die Forensik-Skripte dieser Kette.
// EINE Quelle (G5) fuer die drei Dinge, die hier immer zusammen gelten und einzeln
// still falsch waeren:
//   1. Pool-Lebenszyklus - ohne _pool.end() haengt das Skript am offenen Pool
//      (Muster scripts/grant-admin.js).
//   2. assertNoBypassRls - steckt bereits in createPortalRunner (fail-closed).
//   3. RLS-GUC PRO TENANT - unter FORCE-RLS liefert ein naives SELECT auf call
//      NULL Zeilen. Das ist kein Randfall, sondern der Normalfall (Lehre
//      hermes-db-forensik).
// NUR SELECT. Dieses Modul schreibt nie und kennt keinen DDL-/Migrationspfad.
import { config } from "../src/config.js";
import { createPortalRunner } from "../src/portal-pool.js";

// Praedikat, kein Abbruch: die Diagnose-Meldung gehoert dem jeweiligen Skript
// (unterschiedlicher Aufruf-Hinweis), die Bedingung nur einmal hierher (G5).
export function pgBackendActive() {
  return config.store.storeBackend === "pg";
}

// Fuehrt readRows(client, tenantId) fuer JEDEN Tenant mit gesetzter RLS-GUC aus und
// liefert die flache Vereinigung aller Zeilen. Schliesst den Pool IMMER (auch im
// Fehlerfall) - unconditional, damit kein Aufrufer es vergessen kann und der Test
// es beweisen kann. runner ist injizierbar (DIP/P4): Default = realer Pool,
// Offline-Test injiziert einen Fake mit Query-Log und _pool.end-Spy.
export async function readAcrossTenants(readRows, { runner } = {}) {
  const active = runner ?? (await createPortalRunner());
  try {
    return await active.withClient(async (client) => {
      const tenants = (await client.query(`SELECT id FROM tenant`)).rows;
      const out = [];
      for (const t of tenants) {
        // session-level (false) wie hydrate in store/pg.js - wir fahren KEINE
        // Transaktion, SET LOCAL waere hier wirkungslos.
        await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [t.id]);
        out.push(...(await readRows(client, t.id)));
      }
      return out;
    });
  } finally {
    await active._pool?.end();
  }
}
