import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

import pg from "pg";

import { ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { echteDatenbankMitRolle } from "./test-rolle.js";

const ZEITGRENZE_MS = 120_000;
const KIND_FRIST_MS = 40_000;
const A = "t_fz_a";
const B = "t_fz_b";
const SKRIPT = `const speicher = await import("./src/store.js");
await speicher.oeffneSpeicher();
const treffer = await speicher.faelligeFristen({ art: "hoechstdauer", limitJeMandant: 10, leaseMs: 60000 });
process.stdout.write("ERGEBNIS:" + JSON.stringify(treffer.map((eintrag) => eintrag.callId)));
process.exit(0);`;

async function lauf(adresse) {
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", SKRIPT], {
    cwd: ROOT,
    env: kindUmgebung({ NODE_ENV: "test", STORE_BACKEND: "pg", DATABASE_URL: adresse }),
    timeout: KIND_FRIST_MS,
  });
  return JSON.parse(stdout.split("ERGEBNIS:").at(-1));
}

async function imMandanten(verbindung, tenantId, anweisungen) {
  await verbindung.query("BEGIN");
  await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
  const ergebnis = await anweisungen();
  await verbindung.query("COMMIT");
  return ergebnis;
}

async function aufbau(t) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  assert.deepEqual(await lauf(db.adresse), []);
  const verbindung = new pg.Client({ connectionString: db.adresse });
  await verbindung.connect();
  verbindung.on("error", () => {});
  t.after(() => verbindung.end());
  for (const id of [A, B]) {
    await verbindung.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [id]);
  }
  return { db, verbindung };
}

async function anrufe(verbindung, tenantId, ids) {
  await imMandanten(verbindung, tenantId, async () => {
    for (const id of ids) {
      await verbindung.query(
        `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, frist_hoechstdauer_at)
         VALUES ($1, $2, $3, 'outbound', 'active', now()::text, now() - interval '1 minute')`,
        [id, tenantId, `tok_${id}`],
      );
    }
  });
}

test("Fristen auf echtem Postgres: zwei Prozesse gleichzeitig holen jeden faelligen Anruf beider Mandanten genau einmal", { timeout: ZEITGRENZE_MS }, async (t) => {
  const aufgebaut = await aufbau(t);
  if (!aufgebaut) return;
  const { db, verbindung } = aufgebaut;
  await anrufe(verbindung, A, ["z_a1", "z_a2", "z_a3"]);
  await anrufe(verbindung, B, ["z_b1", "z_b2", "z_b3"]);
  const [erster, zweiter] = await Promise.all([lauf(db.adresse), lauf(db.adresse)]);
  assert.deepEqual([...erster, ...zweiter].sort(), ["z_a1", "z_a2", "z_a3", "z_b1", "z_b2", "z_b3"]);
});

test("Fristen auf echtem Postgres: eine von einem anderen Prozess gesperrte Zeile wird uebersprungen, ohne zu warten", { timeout: ZEITGRENZE_MS }, async (t) => {
  const aufgebaut = await aufbau(t);
  if (!aufgebaut) return;
  const { db, verbindung } = aufgebaut;
  await anrufe(verbindung, A, ["s_gesperrt", "s_frei"]);
  const halter = new pg.Client({ connectionString: db.adresse });
  await halter.connect();
  halter.on("error", () => {});
  t.after(() => halter.end());
  await halter.query("BEGIN");
  await halter.query("SELECT set_config('app.current_tenant', $1, true)", [A]);
  await halter.query("SELECT id FROM call WHERE id = 's_gesperrt' FOR UPDATE");
  assert.deepEqual(await lauf(db.adresse), ["s_frei"]);
  await halter.query("ROLLBACK");
  assert.deepEqual(await lauf(db.adresse), ["s_gesperrt"]);
});
