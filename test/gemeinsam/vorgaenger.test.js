import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import { mitAktivemMutanten } from "../../tools/mutationspruefung/zustand.mjs";
import { ROOT, startServer } from "../helpers.js";
import { echteDatenbank } from "./echtes-postgres.js";
import {
  neuStarten,
  neuUndVorgaenger,
  VORGAENGER_VARIABLE,
  vorgaengerStarten,
} from "./vorgaenger.js";
import { anfrage, gemeinsameUmgebung } from "./zwei-prozesse.js";

const HTTP_OK = 200;
const ZEITGRENZE_MS = 180_000;

function git(...argumente) {
  return execFileSync("git", argumente, { cwd: ROOT, encoding: "utf8" });
}

async function schemaAbbild(db) {
  const verbindung = await db.verbinden();
  const { rows } = await verbindung.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name",
  );
  return rows;
}

function liegtImRepo(verzeichnis) {
  const relativ = path.relative(ROOT, verzeichnis);
  return !relativ.startsWith("..") && !path.isAbsolute(relativ);
}

test(
  "Vorgänger: nach dem neuen Stand gestartet antworten beide auf /healthz, das Schema bleibt gleich",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    let neu = null;
    t.after(() => neu?.stop());
    const db = await echteDatenbank(t);
    if (!db) return;
    neu = await startServer({ env: gemeinsameUmgebung(db.adresse, {}) });
    const schemaVorher = await schemaAbbild(db);
    const vorgaenger = await vorgaengerStarten(t, { adresse: db.adresse, env: {} });
    for (const prozess of [neu, vorgaenger]) {
      const antwort = await anfrage(prozess, "/healthz");
      assert.equal(antwort.status, HTTP_OK);
      assert.equal((await antwort.json()).ok, true);
    }
    assert.equal(liegtImRepo(vorgaenger.wurzel), false);
    if (!process.env[VORGAENGER_VARIABLE]) {
      assert.notEqual(vorgaenger.commit, git("rev-parse", "HEAD").trim());
    }
    assert.deepEqual(await schemaAbbild(db), schemaVorher);
  },
);

test(
  "[NIE1] Der Vorgänger verändert weder Arbeitsbäume noch Arbeitsstand des Haupt-Repos",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const arbeitsbaeumeVorher = git("worktree", "list", "--porcelain");
    const stand = git("status", "--porcelain");
    const prozesse = await neuUndVorgaenger(t);
    if (!prozesse) return;
    await prozesse.vorgaenger.stop();
    assert.equal(git("worktree", "list", "--porcelain"), arbeitsbaeumeVorher);
    assert.equal(git("status", "--porcelain"), stand);
  },
);

test(
  "[NIE2] Der Vorgänger ist ein anderer Commit als HEAD und liegt außerhalb des Repos",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const prozesse = await neuUndVorgaenger(t);
    if (!prozesse) return;
    const { vorgaenger } = prozesse;
    assert.equal(liegtImRepo(vorgaenger.wurzel), false);
    if (!process.env[VORGAENGER_VARIABLE]) {
      assert.notEqual(vorgaenger.commit, git("rev-parse", "HEAD").trim());
    }
  },
);

test(
  "[NIE3] Die Umgebung des Vorgängers enthält nichts von Mutanten- und Abdeckungslauf und hat ein eigenes DATA_DIR",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const prozesse = await neuUndVorgaenger(t);
    if (!prozesse) return;
    const { neu, vorgaenger } = prozesse;
    const lauf = mitAktivemMutanten({});
    for (const schluessel of Object.keys(lauf)) {
      assert.equal(schluessel in vorgaenger.umgebung, false, schluessel);
    }
    assert.equal("NODE_V8_COVERAGE" in vorgaenger.umgebung, false);
    assert.notEqual(vorgaenger.umgebung.DATA_DIR, neu.dataDir);
    assert.ok(vorgaenger.umgebung.DATA_DIR);
  },
);

test(
  "[NIE4] Beide Prozesse führen dieselbe Test-Datenbank hermes_test_<hex>",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const prozesse = await neuUndVorgaenger(t);
    if (!prozesse) return;
    const { db, vorgaenger } = prozesse;
    assert.match(new URL(db.adresse).pathname, /^\/hermes_test_[0-9a-f]+$/);
    assert.equal(vorgaenger.umgebung.DATABASE_URL, db.adresse);
  },
);

const TENANT_MIT_NUMMER = "tenant-vorgaenger-attrappe";

async function vorgaengerStartetOhneSchemaAenderung(t, db) {
  const schemaVorher = await schemaAbbild(db);
  const vorgaenger = await vorgaengerStarten(t, { adresse: db.adresse, env: {} });
  assert.deepEqual(await schemaAbbild(db), schemaVorher);
  return vorgaenger;
}

async function zerstoerendeMigrationEinspielen(db) {
  const verbindung = await db.verbinden();
  await verbindung.query("INSERT INTO tenant (id) VALUES ($1)", [TENANT_MIT_NUMMER]);
  await verbindung.query("INSERT INTO number (id, tenant_id, e164) VALUES ($1, $2, $3)", [
    "nummer-vorgaenger-attrappe",
    TENANT_MIT_NUMMER,
    "+4915112345678",
  ]);
  await verbindung.query("ALTER TABLE tenant RENAME COLUMN default_language TO sprache_standard");
}

test(
  "[NIE1] Nach einer zerstörenden Migration scheitert der Vorgänger am umbenannten tenant.default_language",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const neuer = await neuStarten(t);
    if (!neuer) return;
    await zerstoerendeMigrationEinspielen(neuer.db);
    await assert.rejects(
      vorgaengerStartetOhneSchemaAenderung(t, neuer.db),
      /vorzeitig beendet[\s\S]*default_language/,
    );
  },
);

test(
  "[NIE2] Dieselbe Schema-Prüfung ohne zerstörende Migration ist grün",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const neuer = await neuStarten(t);
    if (!neuer) return;
    const vorgaenger = await vorgaengerStartetOhneSchemaAenderung(t, neuer.db);
    assert.equal((await (await anfrage(vorgaenger, "/healthz")).json()).ok, true);
  },
);
