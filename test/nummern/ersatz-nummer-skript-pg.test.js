import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASE_ENV, tempDataDir } from "../helpers.js";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { BOOTSTRAP_TENANT_ID, makePgStoreMitSperre } from "../pg-helpers.js";
import { neuePglite, pgliteSocketServer } from "../pglite-helfer.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FREMD = "fremd-a";
const ALT = "+17067101188";
const NEU = "+12025550143";
const FREMD_ALT = "+12025550177";
const FREMD_NEU = "+12025550178";
const AUFTRAEGE = "SELECT id, tenant_id, kind FROM provisioning_job ORDER BY id";
const NUMMERN = "SELECT e164 FROM number ORDER BY e164";

async function mandantSicht(db, tenantId, text) {
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
  return (await db.query(text)).rows;
}

async function aufbau({ mitSpur }) {
  const db = await neuePglite();
  await db.exec("CREATE ROLE migrations_rolle NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT CREATE ON SCHEMA public TO migrations_rolle; SET ROLE migrations_rolle;");
  const runner = { withClient: (arbeit) => arbeit({ query: (t, w) => db.query(t, w), exec: (sql) => db.exec(sql) }) };
  await makePgStoreMitSperre(runner).init();
  for (const [mandant, alt, neu] of [[BOOTSTRAP_TENANT_ID, ALT, NEU], [FREMD, FREMD_ALT, FREMD_NEU]]) {
    await db.query("SELECT set_config('app.current_tenant', $1, false)", [mandant]);
    await db.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, 'active', $1, 'US') ON CONFLICT (id) DO NOTHING", [mandant]);
    const mitNeu = mandant === FREMD || mitSpur;
    await db.query("INSERT INTO number (id, tenant_id, e164, provider, status) VALUES ($2, $1, $3, 'telnyx', 'active')", [mandant, `num_alt_${mandant}`, alt]);
    if (mitNeu) await db.query("INSERT INTO number (id, tenant_id, e164, provider, status) VALUES ($2, $1, $3, 'telnyx', 'active')", [mandant, `num_neu_${mandant}`, neu]);
    await db.query("INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, created_at) VALUES ($2, $1, $3, 'provision_number', 'done', $4, 1, now())", [mandant, `job_kauf_${mandant}`, `num_alt_${mandant}`, `provision_${mandant}`]);
    if (mandant === FREMD || mitSpur) {
      await db.query("INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, created_at) VALUES ($2, $1, $3, 'number_swap', 'done', $4, 1, now())", [mandant, `job_spur_${mandant}`, `num_neu_${mandant}`, `tausch_num_alt_${mandant}`]);
    }
  }
  return db;
}

async function rueckbau(db) {
  const server = pgliteSocketServer(db);
  await server.start();
  const adresse = server.getServerConn();
  const kind = spawn(process.execPath, ["scripts/seed-owner-number.js", NEU, "telnyx", "--rueckbau", ALT], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, DATA_DIR: tempDataDir(), STORE_BACKEND: "pg", DATABASE_URL: `postgres://postgres@${adresse}/postgres?sslmode=disable` }),
  });
  let ausgabe = "";
  kind.stdout.on("data", (teil) => (ausgabe += teil));
  kind.stderr.on("data", (teil) => (ausgabe += teil));
  const status = await new Promise((fertig) => kind.on("close", fertig));
  await server.stop();
  return { status, ausgabe };
}

test("rueckbau im pg-Speicher: die Ersatz-Spur ist weg, Kauf-Auftrag und beide Nummern bleiben", async () => {
  const db = await aufbau({ mitSpur: true });
  const lauf = await rueckbau(db);
  assert.equal(lauf.status, 0, lauf.ausgabe);
  const owner = await mandantSicht(db, BOOTSTRAP_TENANT_ID, AUFTRAEGE);
  assert.deepEqual(owner, [{ id: `job_kauf_${BOOTSTRAP_TENANT_ID}`, tenant_id: BOOTSTRAP_TENANT_ID, kind: "provision_number" }]);
  assert.deepEqual(await mandantSicht(db, BOOTSTRAP_TENANT_ID, NUMMERN), [{ e164: NEU }, { e164: ALT }].sort((a, b) => a.e164.localeCompare(b.e164)));
});

test("rueckbau im pg-Speicher: die Spur eines anderen Mandanten bleibt stehen", async () => {
  const db = await aufbau({ mitSpur: true });
  assert.equal((await rueckbau(db)).status, 0);
  const fremd = await mandantSicht(db, FREMD, AUFTRAEGE);
  assert.deepEqual(fremd.map((zeile) => zeile.id), [`job_kauf_${FREMD}`, `job_spur_${FREMD}`]);
});

test("rueckbau im pg-Speicher: ohne Spur endet das Skript mit Abbruch und Status 1, kein Auftrag verschwindet", async () => {
  const db = await aufbau({ mitSpur: false });
  const lauf = await rueckbau(db);
  assert.equal(lauf.status, 1);
  assert.match(lauf.ausgabe, /Abbruch/);
  assert.equal((await mandantSicht(db, BOOTSTRAP_TENANT_ID, AUFTRAEGE)).length, 1);
  assert.equal((await mandantSicht(db, FREMD, AUFTRAEGE)).length, 2);
});
