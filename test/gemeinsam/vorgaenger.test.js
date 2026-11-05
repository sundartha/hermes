import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BASE_ENV, ROOT, startServer } from "../helpers.js";
import { withoutGitVariables } from "../werkzeuge/git-umgebung.mjs";
import { echteDatenbank } from "./echtes-postgres.js";
import {
  abhaengigkeitenBereitstellen,
  neuStarten,
  neuUndVorgaenger,
  VORGAENGER_VARIABLE,
  vorgaengerCommit,
  vorgaengerStarten,
  WURZEL_PRAEFIX,
} from "./vorgaenger.js";
import { anfrage, gemeinsameUmgebung } from "./zwei-prozesse.js";

const HTTP_OK = 200;
const COMMITS_MIT_ELTERNTEIL = 3;
const COMMITS_FREMDES_REPO = 1;
const ZEITGRENZE_MS = 180_000;

function git(...argumente) {
  return execFileSync("git", argumente, {
    cwd: ROOT,
    encoding: "utf8",
    env: withoutGitVariables(process.env),
  });
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
  "[NIE3] Die Umgebung des Vorgängers enthält nur Bekanntes, nichts vom Mutanten- und Abdeckungslauf, und hat ein eigenes DATA_DIR",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const prozesse = await neuUndVorgaenger(t);
    if (!prozesse) return;
    const { db, neu, vorgaenger } = prozesse;
    const erlaubt = new Set([
      "PATH",
      "DATA_DIR",
      ...Object.keys(BASE_ENV),
      ...Object.keys(gemeinsameUmgebung(db.adresse, {})),
    ]);
    for (const schluessel of Object.keys(vorgaenger.umgebung)) {
      assert.equal(erlaubt.has(schluessel), true, schluessel);
    }
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

const OHNE_DATENBANK = { STORE_BACKEND: "json", DATABASE_URL: "" };
const UNERREICHBARE_DATENBANK = {
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgresql://127.0.0.1:1/nirgends",
};
const NICHT_VORHANDENER_HASH = "0123456789abcdef0123456789abcdef01234567";
const WARTEZEITEN_LISTE = "tools/basis/echte-wartezeiten.json";

function wurzelnMitPraefix() {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(WURZEL_PRAEFIX));
}

function neueWurzeln(vorher) {
  return wurzelnMitPraefix().filter((name) => !vorher.includes(name));
}

function istBeendet(kindprozess) {
  return kindprozess.exitCode !== null || kindprozess.signalCode !== null;
}

function gitIn(verzeichnis, ...argumente) {
  const kennung = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid"];
  return execFileSync("git", [...kennung, "-c", "commit.gpgsign=false", ...argumente], {
    cwd: verzeichnis,
    encoding: "utf8",
    env: withoutGitVariables(process.env),
  }).trim();
}

function wegwerfVerzeichnis(t, praefix) {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  t.after(() => fs.promises.rm(verzeichnis, { recursive: true, force: true }));
  return verzeichnis;
}

function wegwerfRepo(t, anzahlCommits) {
  const repo = wegwerfVerzeichnis(t, "hermes-probe-repo-");
  gitIn(repo, "init", "--quiet");
  for (let nummer = 1; nummer <= anzahlCommits; nummer += 1) {
    gitIn(repo, "commit", "--allow-empty", "--quiet", "-m", `Commit ${nummer}`);
  }
  return repo;
}

function abhaengigkeitsPaar(t, { lockQuelle, lockWurzel }) {
  const quelle = wegwerfVerzeichnis(t, "hermes-probe-quelle-");
  const wurzel = wegwerfVerzeichnis(t, "hermes-probe-wurzel-");
  fs.mkdirSync(path.join(quelle, "node_modules", "paket-a"), { recursive: true });
  fs.mkdirSync(path.join(quelle, "node_modules", ".cache"));
  fs.writeFileSync(path.join(quelle, "package-lock.json"), lockQuelle);
  fs.writeFileSync(path.join(wurzel, "package-lock.json"), lockWurzel);
  return { quelle, wurzel };
}

test(
  "[NIE1] Nach grünem Ende sind beide Prozesse gestoppt und das Wegwerfverzeichnis ist gelöscht",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const vorher = wurzelnMitPraefix();
    const neu = await startServer();
    t.after(() => neu.stop());
    const vorgaenger = await vorgaengerStarten(t, { adresse: "", env: OHNE_DATENBANK });
    assert.equal(fs.existsSync(vorgaenger.wurzel), true);
    await neu.stop();
    await vorgaenger.entfernen();
    assert.equal(istBeendet(neu.child), true);
    assert.equal(istBeendet(vorgaenger.child), true);
    assert.equal(fs.existsSync(vorgaenger.wurzel), false);
    assert.deepEqual(neueWurzeln(vorher), []);
  },
);

test(
  "[NIE1] Scheitert der Start des Vorgängers, bleibt kein Wegwerfverzeichnis liegen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const vorher = wurzelnMitPraefix();
    const fehler = await vorgaengerStarten(t, { adresse: "", env: UNERREICHBARE_DATENBANK }).then(
      () => null,
      (grund) => grund,
    );
    assert.match(fehler?.message ?? "", /vorzeitig beendet/);
    assert.equal(typeof fehler.wurzel, "string");
    assert.equal(fs.existsSync(fehler.wurzel), false);
    assert.deepEqual(neueWurzeln(vorher), []);
  },
);

test(
  "[NIE2] Eine Überschreibung auf einen nicht vorhandenen Hash bricht rot ab und nennt die Variable",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    await assert.rejects(
      vorgaengerStarten(t, { adresse: "", festgelegt: NICHT_VORHANDENER_HASH }),
      new RegExp(VORGAENGER_VARIABLE),
    );
  },
);

test("[NIE2] Ohne Basis-Ref oder in einem flachen Repo ist der Vorgänger nicht bestimmbar und nennt die Variable", (t) => {
  const nennt = new RegExp(VORGAENGER_VARIABLE);
  const ohneBasis = wegwerfRepo(t, 2);
  assert.throws(() => vorgaengerCommit({ repo: ohneBasis, festgelegt: "" }), nennt);
  const flach = wegwerfRepo(t, 1);
  gitIn(flach, "update-ref", "refs/remotes/upstream/master", "HEAD");
  assert.throws(() => vorgaengerCommit({ repo: flach, festgelegt: "" }), nennt);
});

test("[NIE3] Bei gleichem package-lock.json zeigen die Einträge von node_modules als Symlinks auf das Haupt-Repo, ohne Installation", (t) => {
  const { quelle, wurzel } = abhaengigkeitsPaar(t, {
    lockQuelle: "lock-gleich",
    lockWurzel: "lock-gleich",
  });
  const installationen = [];
  abhaengigkeitenBereitstellen(wurzel, {
    quelle,
    installieren: (ziel) => installationen.push(ziel),
  });
  assert.deepEqual(installationen, []);
  assert.equal(fs.lstatSync(path.join(wurzel, "node_modules")).isSymbolicLink(), false);
  const eintrag = path.join(wurzel, "node_modules", "paket-a");
  assert.equal(fs.lstatSync(eintrag).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(eintrag), path.join(quelle, "node_modules", "paket-a"));
  assert.equal(fs.existsSync(path.join(wurzel, "node_modules", ".cache")), false);
});

test("[NIE3] Bei abweichendem package-lock.json wird im Wegwerfverzeichnis installiert, nie durch einen Symlink", (t) => {
  const { quelle, wurzel } = abhaengigkeitsPaar(t, {
    lockQuelle: "lock-neu",
    lockWurzel: "lock-alt",
  });
  const installationen = [];
  const modulOrdnerVorhanden = [];
  abhaengigkeitenBereitstellen(wurzel, {
    quelle,
    installieren: (ziel) => {
      installationen.push(ziel);
      modulOrdnerVorhanden.push(fs.existsSync(path.join(ziel, "node_modules")));
    },
  });
  assert.deepEqual(installationen, [wurzel]);
  assert.deepEqual(modulOrdnerVorhanden, [false]);
  assert.equal(fs.existsSync(path.join(wurzel, "node_modules")), false);
});

test("[NIE3] Scheitert die Installation, bricht die Bereitstellung rot ab und legt keine Symlinks an", (t) => {
  const { quelle, wurzel } = abhaengigkeitsPaar(t, {
    lockQuelle: "lock-neu",
    lockWurzel: "lock-alt",
  });
  assert.throws(
    () =>
      abhaengigkeitenBereitstellen(wurzel, {
        quelle,
        installieren: () => {
          throw new Error("npm ci offline gescheitert");
        },
      }),
    /npm ci offline gescheitert/,
  );
  assert.equal(fs.existsSync(path.join(wurzel, "node_modules")), false);
});

test("[NIE4] Auf master selbst ist der Vorgänger der erste Elternteil von HEAD, nie HEAD", (t) => {
  const repo = wegwerfRepo(t, 3);
  const kopf = gitIn(repo, "rev-parse", "HEAD");
  const ersterElternteil = gitIn(repo, "rev-parse", "HEAD^1");
  const urahn = gitIn(repo, "rev-parse", "HEAD~2");
  gitIn(repo, "update-ref", "refs/remotes/upstream/master", kopf);
  assert.equal(vorgaengerCommit({ repo, festgelegt: "" }), ersterElternteil);
  assert.notEqual(vorgaengerCommit({ repo, festgelegt: "" }), kopf);
  gitIn(repo, "update-ref", "refs/remotes/upstream/master", urahn);
  assert.equal(vorgaengerCommit({ repo, festgelegt: "" }), urahn);
});

test("[NIE4] Ein geerbtes GIT_DIR lenkt die Bestimmung des Vorgängers nicht auf ein anderes Repo", (t) => {
  const repo = wegwerfRepo(t, COMMITS_MIT_ELTERNTEIL);
  const kopf = gitIn(repo, "rev-parse", "HEAD");
  const ersterElternteil = gitIn(repo, "rev-parse", "HEAD^1");
  gitIn(repo, "update-ref", "refs/remotes/upstream/master", kopf);
  const fremd = wegwerfRepo(t, COMMITS_FREMDES_REPO);
  const fremdeRefs = gitIn(fremd, "for-each-ref");
  const vorher = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(fremd, ".git");
  t.after(() => {
    if (vorher === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = vorher;
  });
  assert.equal(vorgaengerCommit({ repo, festgelegt: "" }), ersterElternteil);
  assert.equal(gitIn(fremd, "for-each-ref"), fremdeRefs);
});

test(
  "[ELTERNWAECHTER] Schließt der Testprozess die stdin-Leitung des Vorgängers, endet dieser von selbst",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const vorgaenger = await vorgaengerStarten(t, { adresse: "", env: OHNE_DATENBANK });
    const beendet = new Promise((fertig) => vorgaenger.child.once("exit", fertig));
    vorgaenger.child.stdin.end();
    await beendet;
    assert.equal(vorgaenger.child.signalCode, "SIGKILL");
  },
);

test(
  "[NIE5] Das Haupt-Repo ist nach Start und Aufräumen beider Prozesse unverändert",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const arbeitsbaeumeVorher = git("worktree", "list", "--porcelain");
    const stand = git("status", "--porcelain");
    const neu = await startServer();
    t.after(() => neu.stop());
    const vorgaenger = await vorgaengerStarten(t, { adresse: "", env: OHNE_DATENBANK });
    await neu.stop();
    await vorgaenger.entfernen();
    assert.equal(git("worktree", "list", "--porcelain"), arbeitsbaeumeVorher);
    assert.equal(git("status", "--porcelain"), stand);
  },
);

test(
  "[NIE6] Start und Aufräumen brauchen keine eigene feste Wartezeit, kein Eintrag der Liste echter Wartezeiten gehört zum Vorgänger-Gerüst",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const vorgaenger = await vorgaengerStarten(t, { adresse: "", env: OHNE_DATENBANK });
    assert.equal((await (await anfrage(vorgaenger, "/healthz")).json()).ok, true);
    await vorgaenger.entfernen();
    assert.equal(istBeendet(vorgaenger.child), true);
    const eintraege = JSON.parse(fs.readFileSync(path.join(ROOT, WARTEZEITEN_LISTE), "utf8"));
    assert.deepEqual(
      eintraege.filter((eintrag) => JSON.stringify(eintrag).includes("test/gemeinsam/vorgaenger")),
      [],
    );
  },
);
