#!/usr/bin/env node
import { config } from "../src/config.js";
import { createPortalRunner } from "../src/portal-pool.js";

export function pgBackendActive() {
  return config.store.storeBackend === "pg";
}

export async function readAcrossTenants(readRows, { runner } = {}) {
  const active = runner ?? (await createPortalRunner());
  try {
    return await active.withClient(async (client) => {
      const tenants = (await client.query(`SELECT id FROM tenant`)).rows;
      const out = [];
      for (const t of tenants) {
        await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [t.id]);
        out.push(...(await readRows(client, t.id)));
      }
      return out;
    });
  } finally {
    await active._pool?.end();
  }
}
