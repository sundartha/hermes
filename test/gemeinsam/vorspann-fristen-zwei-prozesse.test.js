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
const A = "t_vfz_a";
const SKRIPT = `const speicher = await import("./src/store.js");
await speicher.oeffneSpeicher();
const treffer = await speicher.faelligeFristen({ art: "vorspann", limitJeMandant: 10, leaseMs: 60000 });
process.stdout.write("ERGEBNIS:" + JSON.stringify(treffer.map((eintrag) => eintrag.callId + ":" + eintrag.frist)));
process.exit(0);`;

async function lauf(adresse) {
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", SKRIPT], {
    cwd: ROOT,
    env: kindUmgebung({ NODE_ENV: "test", STORE_BACKEND: "pg", DATABASE_URL: adresse }),
    timeout: KIND_FRIST_MS,
  });
  return JSON.parse(stdout.split("ERGEBNIS:").at(-1));
}

test("Vorspann-Fristen auf echtem Postgres: zwei Prozesse gleichzeitig holen jede faellige Frist genau einmal, ungesetzte nie", { timeout: ZEITGRENZE_MS }, async (t) => {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  assert.deepEqual(await lauf(db.adresse), []);
  const verbindung = new pg.Client({ connectionString: db.adresse });
  await verbindung.connect();
  verbindung.on("error", () => {});
  t.after(() => verbindung.end());
  await verbindung.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [A]);
  await verbindung.query("BEGIN");
  await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [A]);
  for (const id of ["z1", "z2", "z3", "z4"]) {
    await verbindung.query(
      `INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at, frist_klingel_at, frist_el_bein_at)
       VALUES ($1, $2, 'tok', 'satz', now() + interval '1 hour', now() - interval '1 minute', now() - interval '1 minute')`,
      [id, A],
    );
  }
  await verbindung.query(
    "INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at) VALUES ('z_ohne', $1, 'tok', 'satz', now() + interval '1 hour')",
    [A],
  );
  await verbindung.query("COMMIT");
  const [erster, zweiter] = await Promise.all([lauf(db.adresse), lauf(db.adresse)]);
  const alle = ["z1", "z2", "z3", "z4"].flatMap((id) => [`${id}:klingel`, `${id}:elBein`]).sort();
  assert.deepEqual([...erster, ...zweiter].sort(), alle);
});
