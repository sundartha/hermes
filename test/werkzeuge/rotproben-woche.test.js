import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/rotproben-woche.mjs");
const AUFNAHME = JSON.parse(
  readFileSync(join(REPO_ROOT, "test/werkzeuge/rotproben-woche/grundaufzeichnung.json"), "utf8"),
);
const REPOSITORY = "sundartha/hermes";
const PR = AUFNAHME.pr.number;
const CI_LAUF = "37135986339";
const PRUEFUNGEN_LAUF = "37135986363";
const TESTSCHUTZ_LAUF = "37135986342";
const ERSTE_PROBE = 300;
const FREMDER_PR = 112;
const FREMDE_PROBE = 113;
const EXIT_OK = 0;
const EXIT_ROT = 1;
const HTTP_OK = 200;
const HTTP_LEER = 204;
const HTTP_FEHLT = 404;
const HTTP_NICHT_VERARBEITBAR = 422;
const AUSFUEHRBAR = 0o755;
const MS_JE_STUNDE = 3_600_000;
const STUNDEN_JE_TAG = 24;
const ACHT_TAGE = 8;
const FAELLE = ["lint-fehler", "lint-konfiguration", "umgeschriebener-test", "geschuetzte-datei", "ts-any", "ts-as", "ts-typfehler"];
const TS_VORLAGEN = [
  "test/werkzeuge/rotproben/eslint/ts-any.json",
  "test/werkzeuge/rotproben/eslint/ts-as.json",
  "test/werkzeuge/rotproben/typpruefung/typfehler-der-laeuft.json",
];
const TS_PROBE = "src/probe/probe.ts";
const ANKERDATEIEN = {
  "src/billing/provider-enum.js": "export const MAX_ENUM_LENGTH = 64;\n",
  "eslint.config.js": 'export default [{ rules: { "no-useless-constructor": "error" } }];\n',
  "test/plans-find-plan.test.js": 'assert.equal(findPlan("nope"), null);\n',
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n",
  ...Object.fromEntries(TS_VORLAGEN.map((pfad) => [pfad, readFileSync(join(REPO_ROOT, pfad), "utf8")])),
};
const ERWARTETE_AENDERUNGEN = new Map([
  ["lint-fehler", /^\+\/\/ const ALTE_GRENZE = MAX_ENUM_LENGTH;$/m],
  ["lint-konfiguration", /^\+.*"no-useless-constructor": "off"/m],
  ["umgeschriebener-test", /^\+assert\.equal\(findPlan\("gibt-es-nicht"\), null\);$/m],
  ["geschuetzte-datei", /^\+$/m],
  ["ts-any", /^new file mode 100644\n(?:.*\n)*\+export function verdoppelt\(wert: any\): number \{$/m],
  ["ts-as", /^new file mode 100644\n(?:.*\n)*\+ {2}return roh as Anruf;$/m],
  ["ts-typfehler", /^new file mode 100644\n(?:.*\n)*\+const SEKUNDEN: number = "dreissig";$/m],
]);
const LINT_GESTOPPT = /^\| lint-fehler \| #233 \| CI \/ Prüfungen \/ Lint \| gestoppt \|$/m;

function haken(...zeilen) {
  return ["#!/bin/sh", ...zeilen, ""].join("\n");
}

const REGEL_HAKEN = haken(
  'echo "error: GH013: Repository rule violations found for refs/heads/master." >&2',
  'echo "- Changes must be made through a pull request." >&2',
  "exit 1",
);
const RECHTE_HAKEN = haken(
  'echo "Permission to sundartha/hermes.git denied to sundartha-agent[bot]." >&2',
  "exit 1",
);
const NUR_MASTER_HAKEN = haken(
  "while read alt neu ref; do",
  '  if [ "$ref" = "refs/heads/master" ]; then',
  '    echo "error: GH013: Repository rule violations found for refs/heads/master." >&2',
  "    exit 1",
  "  fi",
  "done",
);

function werkzeug(argumente, { cwd = REPO_ROOT, umgebung = {} } = {}) {
  const env = {
    ...isolatedEnvironment(),
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    GITHUB_API_URL: "http://127.0.0.1:1",
    GITHUB_REPOSITORY: REPOSITORY,
    ROTPROBEN_ABSTAND_MS: "0",
    ...umgebung,
  };
  return new Promise((fertig) => {
    execFile(process.execPath, [TOOL, ...argumente], { cwd, env }, (fehler, stdout, stderr) =>
      fertig({ status: fehler ? fehler.code : EXIT_OK, stdout, stderr }),
    );
  });
}

function gitIn(ordner, argumente) {
  const lauf = runIn(ordner, "git", argumente);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return lauf.stdout.trim();
}

function ersteSeite(url, liste) {
  return url.searchParams.get("page") === "1" ? liste : [];
}

const ROUTEN = [
  [/^\/rules\/branches\/master$/, ({ zustand }) => [HTTP_OK, zustand.regeln]],
  [
    /^\/pulls$/,
    ({ zustand, url }) => {
      const offen = url.searchParams.get("state") === "open";
      return [HTTP_OK, ersteSeite(url, offen ? zustand.offen : zustand.geschlossen)];
    },
  ],
  [/^\/pulls\/(\d+)\/reviews$/, ({ zustand, nummer }) => [HTTP_OK, zustand.reviews.get(nummer) ?? []]],
  [
    /^\/pulls\/(\d+)$/,
    ({ zustand, nummer, methode }) => [HTTP_OK, methode === "GET" ? zustand.pulls.get(nummer) : {}],
  ],
  [/^\/actions\/runs$/, ({ zustand }) => [HTTP_OK, { workflow_runs: zustand.laeufe }]],
  [/^\/actions\/runs\/(\d+)\/jobs$/, ({ zustand, wert }) => [HTTP_OK, { jobs: zustand.jobs[wert] }]],
  [
    /^\/commits\/\w+\/check-runs$/,
    ({ zustand, url }) => {
      const name = url.searchParams.get("check_name");
      return [HTTP_OK, { check_runs: zustand.checks.filter((check) => check.name === name) }];
    },
  ],
  [
    /^\/git\/refs\/heads\/(.+)$/,
    ({ zustand, wert }) => (zustand.schonWeg.has(wert) ? [HTTP_NICHT_VERARBEITBAR, {}] : [HTTP_LEER]),
  ],
];

function beantworte(zustand, methode, url) {
  const pfad = url.pathname.slice(`/repos/${REPOSITORY}`.length);
  for (const [muster, antwort] of ROUTEN) {
    const treffer = muster.exec(pfad);
    if (treffer) return antwort({ zustand, url, methode, wert: treffer[1], nummer: Number(treffer[1]) });
  }
  return [HTTP_FEHLT, {}];
}

async function nachgebauteApi(context, zustand) {
  const anfragen = [];
  const server = createServer(async (anfrage, antwort) => {
    const stuecke = [];
    for await (const stueck of anfrage) stuecke.push(stueck);
    const text = Buffer.concat(stuecke).toString("utf8");
    const url = new URL(anfrage.url, "http://127.0.0.1");
    anfragen.push({ methode: anfrage.method, pfad: url.pathname, koerper: text && JSON.parse(text) });
    const [status, inhalt] = beantworte(zustand, anfrage.method, url);
    antwort.writeHead(status, { "content-type": "application/json" });
    antwort.end(inhalt === undefined ? undefined : JSON.stringify(inhalt));
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  context.after(() => server.close());
  const adresse = `http://127.0.0.1:${server.address().port}`;
  return { anfragen, umgebung: { GITHUB_API_URL: adresse, GH_TOKEN: "attrappe" } };
}

function zustandAus(aufnahme, weiteres = {}) {
  return {
    ...aufnahme,
    pulls: new Map([[aufnahme.pr.number, aufnahme.pr]]),
    offen: [],
    geschlossen: [],
    reviews: new Map(),
    schonWeg: new Set(),
    ...weiteres,
  };
}

function mitSchritt(aufnahme, { lauf, schritt, ergebnis = "failure" }) {
  const setze = (eintrag) => (eintrag.name === schritt ? { ...eintrag, conclusion: ergebnis } : eintrag);
  const jobs = aufnahme.jobs[lauf].map((job) => ({ ...job, steps: job.steps.map(setze) }));
  return { ...aufnahme, jobs: { ...aufnahme.jobs, [lauf]: jobs } };
}

function mitTyppruefung(aufnahme, ergebnis) {
  const zusatz = (schritte) =>
    schritte.flatMap((eintrag) => (eintrag.name === "Lint" ? [eintrag, { ...eintrag, name: "Typprüfung", conclusion: ergebnis }] : [eintrag]));
  const jobs = aufnahme.jobs[CI_LAUF].map((job) => ({ ...job, steps: zusatz(job.steps) }));
  return { ...aufnahme, jobs: { ...aufnahme.jobs, [CI_LAUF]: jobs } };
}

function lintRot(aufnahme = AUFNAHME) {
  return mitSchritt(aufnahme, { lauf: CI_LAUF, schritt: "Lint" });
}

function allesGruen(aufnahme) {
  const text = JSON.stringify(aufnahme).replaceAll('"conclusion":"failure"', '"conclusion":"success"');
  return JSON.parse(text);
}

async function auswerten(context, aufnahme, fall = "lint-fehler") {
  const api = await nachgebauteApi(context, zustandAus(aufnahme));
  return werkzeug(["--auswerten", `${fall}=${PR}`], { umgebung: api.umgebung });
}

function upstreamMit(context, hakenText) {
  const arbeit = probeRepository(context, ANKERDATEIEN);
  const nackt = join(probeDirectory(context, {}), "upstream.git");
  gitIn(arbeit, ["init", "-q", "--bare", nackt]);
  gitIn(arbeit, ["config", "user.name", "Probe"]);
  gitIn(arbeit, ["config", "user.email", "probe@example.invalid"]);
  gitIn(arbeit, ["config", "commit.gpgsign", "false"]);
  gitIn(arbeit, ["remote", "add", "upstream", nackt]);
  gitIn(arbeit, ["push", "-q", "upstream", "HEAD:refs/heads/master"]);
  gitIn(arbeit, ["switch", "-q", "-c", "arbeit"]);
  if (hakenText) {
    writeFileSync(join(nackt, "hooks/pre-receive"), hakenText);
    chmodSync(join(nackt, "hooks/pre-receive"), AUSFUEHRBAR);
  }
  return { arbeit, nackt, vorher: gitIn(nackt, ["rev-parse", "refs/heads/master"]) };
}

function vorTagen(tage) {
  return new Date(Date.now() - tage * STUNDEN_JE_TAG * MS_JE_STUNDE).toISOString();
}

function gemergt(nummer, { tage = 1, label = "art:code" } = {}) {
  const zeit = vorTagen(tage);
  const labels = [{ name: label }];
  return { ...AUFNAHME.pr, number: nummer, state: "closed", merged_at: zeit, updated_at: zeit, labels };
}

function approveVorMerge(pull, login = "jonas986") {
  const vorher = new Date(Date.parse(pull.merged_at) - MS_JE_STUNDE).toISOString();
  return [pull.number, [{ user: { login }, state: "APPROVED", submitted_at: vorher }]];
}

async function ohneMenschen(context, pulls, reviews = []) {
  const api = await nachgebauteApi(context, zustandAus(AUFNAHME, { geschlossen: pulls, reviews: new Map(reviews) }));
  return werkzeug(["--ohne-menschen"], { umgebung: api.umgebung });
}

function probePull(nummer, ref) {
  return { ...AUFNAHME.pr, number: nummer, head: { ...AUFNAHME.pr.head, ref } };
}

async function nurPatchesIn(context, dateien) {
  const arbeit = probeRepository(context, dateien);
  const ordner = join(probeDirectory(context, {}), "patches");
  const lauf = await werkzeug(["--nur-patches", ordner], { cwd: arbeit });
  return { arbeit, ordner, lauf };
}

test("Rot-Proben: --nur-patches schreibt sieben anwendbare Patches und lässt den Arbeitsbaum unverändert", async (context) => {
  const { arbeit, ordner, lauf } = await nurPatchesIn(context, ANKERDATEIEN);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(readdirSync(ordner).sort(), FAELLE.map((fall) => `${fall}.patch`).sort());
  for (const [fall, aenderung] of ERWARTETE_AENDERUNGEN) {
    const patch = join(ordner, `${fall}.patch`);
    assert.match(readFileSync(patch, "utf8"), aenderung);
    assert.equal(runIn(arbeit, "git", ["apply", "--check", patch]).status, EXIT_OK, fall);
  }
  assert.equal(gitIn(arbeit, ["status", "--porcelain", "--untracked-files=all"]), "");
  assert.match(lauf.stdout, /^- geschuetzte-datei: .*geschuetzte-datei\.patch$/m);
});

test("Rot-Proben: --nur-patches nimmt den Inhalt einer TypeScript-Probe aus ihrem Manifest", async (context) => {
  const manifest = { titel: "geändert", dateien: { [TS_PROBE]: ["export const ANDERS: number = 1;"] } };
  const { ordner, lauf } = await nurPatchesIn(context, { ...ANKERDATEIEN, [TS_VORLAGEN[0]]: JSON.stringify(manifest) });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const patch = readFileSync(join(ordner, "ts-any.patch"), "utf8");
  assert.match(patch, /^\+export const ANDERS: number = 1;$/m);
  assert.doesNotMatch(patch, /any/);
});

test("Rot-Proben: --nur-patches meldet laut, wenn es die Datei einer TypeScript-Probe schon gibt, und lässt sie stehen", async (context) => {
  const { arbeit, lauf } = await nurPatchesIn(context, { ...ANKERDATEIEN, [TS_PROBE]: "export const DA = 1;\n" });
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^ts-any: nicht erzeugbar: src\/probe\/probe\.ts gibt es schon$/m);
  assert.equal(readFileSync(join(arbeit, TS_PROBE), "utf8"), "export const DA = 1;\n");
  assert.equal(gitIn(arbeit, ["status", "--porcelain", "--untracked-files=all"]), "");
});

test("Rot-Proben: --nur-patches legt mehrere neue Dateien in neuen Ordnern an und räumt sie wieder weg", async (context) => {
  const dateien = { "src/neu/eins.ts": ["export const EINS: number = 1;"], "test/neu/zwei.ts": ["export const ZWEI: number = 2;"] };
  const { arbeit, ordner, lauf } = await nurPatchesIn(context, { ...ANKERDATEIEN, [TS_VORLAGEN[0]]: JSON.stringify({ titel: "zwei", dateien }) });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const patch = join(ordner, "ts-any.patch");
  assert.match(readFileSync(patch, "utf8"), /^\+\+\+ b\/src\/neu\/eins\.ts$(?:.*\n)*^\+\+\+ b\/test\/neu\/zwei\.ts$/m);
  assert.equal(runIn(arbeit, "git", ["apply", "--check", patch]).status, EXIT_OK);
  assert.deepEqual(readdirSync(join(arbeit, "src")).sort(), ["billing"]);
  assert.equal(gitIn(arbeit, ["status", "--porcelain", "--untracked-files=all", "--ignored"]), "");
});

test("Rot-Proben: --nur-patches lässt einen schon vorhandenen Ordner mit seinen Dateien stehen", async (context) => {
  const { arbeit, lauf } = await nurPatchesIn(context, { ...ANKERDATEIEN, "src/probe/bleibt.js": "export const BLEIBT = 1;\n" });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(readdirSync(join(arbeit, "src/probe")), ["bleibt.js"]);
});

test("Rot-Proben: --nur-patches meldet laut, wenn das Manifest einer TypeScript-Probe vorher oder loeschen braucht", async (context) => {
  for (const feld of ["vorher", "loeschen"]) {
    const manifest = { titel: "mit Vorstand", dateien: { [TS_PROBE]: ["export const X = 1;"] }, [feld]: feld === "vorher" ? { "src/alt.js": ["export const A = 1;"] } : ["src/billing/provider-enum.js"] };
    const { lauf } = await nurPatchesIn(context, { ...ANKERDATEIEN, [TS_VORLAGEN[1]]: JSON.stringify(manifest) });
    assert.equal(lauf.status, EXIT_ROT);
    assert.match(lauf.stderr, /^ts-as: nicht erzeugbar: test\/werkzeuge\/rotproben\/eslint\/ts-as\.json braucht vorher oder loeschen/m);
  }
});

test("Rot-Proben: --nur-patches meldet laut, wenn das Manifest einer TypeScript-Probe keine Dateien nennt", async (context) => {
  for (const dateien of [undefined, null, {}, [TS_PROBE], "src/probe/probe.ts"]) {
    const { lauf } = await nurPatchesIn(context, { ...ANKERDATEIEN, [TS_VORLAGEN[0]]: JSON.stringify({ titel: "ohne Dateien", dateien }) });
    assert.equal(lauf.status, EXIT_ROT);
    assert.match(lauf.stderr, /^ts-any: nicht erzeugbar: test\/werkzeuge\/rotproben\/eslint\/ts-any\.json nennt keine Dateien$/m);
  }
});

test("Rot-Proben: --nur-patches meldet laut, wenn das Manifest einer TypeScript-Probe fehlt", async (context) => {
  const ohneManifest = Object.fromEntries(Object.entries(ANKERDATEIEN).filter(([pfad]) => pfad !== TS_VORLAGEN[2]));
  const { lauf } = await nurPatchesIn(context, ohneManifest);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^ts-typfehler: nicht erzeugbar: test\/werkzeuge\/rotproben\/typpruefung\/typfehler-der-laeuft\.json fehlt$/m);
});

test("Rot-Proben: --nur-patches bricht laut ab, wenn eine Ankerzeile fehlt, und nennt die Datei", async (context) => {
  const { arbeit, lauf } = await nurPatchesIn(context, { ...ANKERDATEIEN, "eslint.config.js": "export default [];\n" });
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^lint-konfiguration: nicht erzeugbar: eslint\.config\.js\//m);
  assert.equal(gitIn(arbeit, ["status", "--porcelain"]), "");
});

test("Rot-Proben: --auswerten meldet gestoppt, wenn der erwartete Schritt und der Pflicht-Check rot sind", async (context) => {
  const lauf = await auswerten(context, lintRot());
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.stdout, LINT_GESTOPPT);
});

test("Rot-Proben: --auswerten meldet ts-typfehler als gestoppt, wenn die Typprüfung und der Pflicht-Check rot sind", async (context) => {
  const lauf = await auswerten(context, mitTyppruefung(AUFNAHME, "failure"), "ts-typfehler");
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.stdout, /^\| ts-typfehler \| #233 \| CI \/ Prüfungen \/ Typprüfung \| gestoppt \|$/m);
});

test("Rot-Proben: --auswerten meldet bei ts-typfehler den falschen Schritt, wenn nur Lint rot ist", async (context) => {
  const lauf = await auswerten(context, lintRot(mitTyppruefung(AUFNAHME, "success")), "ts-typfehler");
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stdout, /^\| ts-typfehler \| #233 \| .* \| falscher Schritt: Prüfungen \/ Lint \|$/m);
});

test("Rot-Proben: --auswerten meldet durchgegangen, wenn alles grün ist", async (context) => {
  const lauf = await auswerten(context, allesGruen(AUFNAHME));
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /^\| lint-fehler \| #233 \| CI \/ Prüfungen \/ Lint \| durchgegangen \|$/m);
});

test("Rot-Proben: --auswerten meldet den falschen Schritt, wenn ein anderer Schritt rot ist und Lint grün", async (context) => {
  const lauf = await auswerten(context, AUFNAHME);
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /\| falscher Schritt: Tests 2\/4 \/ Testlaufzeit \|$/m);
});

test("Rot-Proben: --auswerten zählt nicht als gestoppt, wenn der Check kein Pflicht-Check ist", async (context) => {
  const regeln = AUFNAHME.regeln.map((regel) =>
    regel.type === "required_status_checks"
      ? { ...regel, parameters: { required_status_checks: [{ context: "Testschutz" }] } }
      : regel,
  );
  const lauf = await auswerten(context, lintRot({ ...AUFNAHME, regeln }));
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /\| durchgegangen: „CI“ ist kein Pflicht-Check \|$/m);
});

test("Rot-Proben: --auswerten meldet rot, wenn an der Probe Auto-Merge gesetzt ist", async (context) => {
  const pr = { ...AUFNAHME.pr, auto_merge: { merge_method: "squash" } };
  const lauf = await auswerten(context, lintRot({ ...AUFNAHME, pr }));
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /\| Auto-Merge an einer Probe \|$/m);
});

test("Rot-Proben: --auswerten meldet Zeit abgelaufen, wenn der Lauf nicht fertig wird", async (context) => {
  const laeufe = AUFNAHME.laeufe.map((eintrag) =>
    eintrag.name === "CI" ? { ...eintrag, status: "in_progress", conclusion: null } : eintrag,
  );
  const lauf = await auswerten(context, { ...AUFNAHME, laeufe });
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /\| Zeit abgelaufen \|$/m);
});

test("Rot-Proben: --nur-push meldet gestoppt, wenn upstream den Push mit GH013 ablehnt, und master bleibt gleich", async (context) => {
  const { arbeit, nackt, vorher } = upstreamMit(context, REGEL_HAKEN);
  const lauf = await werkzeug(["--nur-push"], { cwd: arbeit });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.stdout, /^Push-Probe \(push-auf-master\): gestoppt/m);
  assert.equal(gitIn(nackt, ["rev-parse", "refs/heads/master"]), vorher);
  assert.equal(gitIn(arbeit, ["branch", "--show-current"]), "arbeit");
  assert.equal(gitIn(arbeit, ["status", "--porcelain"]), "");
});

test("Rot-Proben: --nur-push meldet SPERRE FEHLT in der ersten Zeile, wenn upstream den Push annimmt", async (context) => {
  const { arbeit, nackt, vorher } = upstreamMit(context, undefined);
  const lauf = await werkzeug(["--nur-push"], { cwd: arbeit });
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /^SPERRE FEHLT: direkter Push auf master wurde angenommen \(leerer Commit [0-9a-f]+/);
  assert.equal(gitIn(nackt, ["rev-parse", "refs/heads/master^"]), vorher);
  assert.equal(gitIn(nackt, ["rev-parse", "refs/heads/master^{tree}"]), gitIn(nackt, [
    "rev-parse",
    `${vorher}^{tree}`,
  ]));
});

test("Rot-Proben: --nur-push meldet falschen Grund, wenn upstream wegen fehlender Rechte ablehnt", async (context) => {
  const { arbeit, nackt, vorher } = upstreamMit(context, RECHTE_HAKEN);
  const lauf = await werkzeug(["--nur-push"], { cwd: arbeit });
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /^Push-Probe \(push-auf-master\): falscher Grund: .*Permission to/m);
  assert.equal(gitIn(nackt, ["rev-parse", "refs/heads/master"]), vorher);
});

test("Rot-Proben: --aufraeumen schließt nur die sieben Probe-PRs und löscht nur ihre Branches", async (context) => {
  const proben = FAELLE.map((fall, index) => probePull(ERSTE_PROBE + index, `rotprobe/20-${fall}`));
  const fremde = [probePull(FREMDER_PR, "paket/20-soll-und-rotproben"), probePull(FREMDE_PROBE, "rotprobe/05-label-antonio")];
  const zustand = zustandAus(AUFNAHME, { offen: [...fremde, ...proben], schonWeg: new Set(["rotprobe/20-lint-fehler"]) });
  const api = await nachgebauteApi(context, zustand);
  const lauf = await werkzeug(["--aufraeumen"], { umgebung: api.umgebung });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const schreibend = api.anfragen.filter(({ methode }) => methode !== "GET");
  const geschlossen = schreibend.filter(({ methode }) => methode === "PATCH");
  assert.deepEqual(geschlossen.map(({ pfad }) => pfad), proben.map(({ number }) => `/repos/${REPOSITORY}/pulls/${number}`));
  assert.ok(geschlossen.every(({ koerper }) => koerper.state === "closed"));
  const geloescht = schreibend.filter(({ methode }) => methode === "DELETE").map(({ pfad }) => pfad);
  assert.deepEqual(geloescht, FAELLE.map((fall) => `/repos/${REPOSITORY}/git/refs/heads/rotprobe/20-${fall}`));
  assert.equal(schreibend.length, geschlossen.length + geloescht.length);
  assert.match(lauf.stdout, /^Aufgeräumt: offene Proben-PRs geschlossen: #300, #301, #302, #303, #304, #305, #306;/m);
});

test("Rot-Proben: --ohne-menschen ist grün und meldet keine solchen PRs, wenn nichts gemergt wurde", async (context) => {
  const lauf = await ohneMenschen(context, []);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.stdout, /^keine solchen PRs/m);
});

test("Rot-Proben: --ohne-menschen ist grün bei einem art:code-PR ohne Approve", async (context) => {
  const lauf = await ohneMenschen(context, [gemergt(ERSTE_PROBE)]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.stdout, /^In 7 Tagen gemergte PRs mit Label art:code oder art:strenger: 1 \(#300\)\. Keiner hat ein Approve/m);
});

test("Rot-Proben: --ohne-menschen ist rot bei einem art:code-PR mit Approve von jonas986 vor dem Merge", async (context) => {
  const pull = gemergt(ERSTE_PROBE);
  const lauf = await ohneMenschen(context, [pull], [approveVorMerge(pull)]);
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stdout, /Mit Approve vor dem Merge: #300 \(jonas986\)\.$/m);
});

test("Rot-Proben: --ohne-menschen übergeht einen art:pruefung-PR mit Approve", async (context) => {
  const pull = gemergt(ERSTE_PROBE, { label: "art:pruefung" });
  const lauf = await ohneMenschen(context, [pull], [approveVorMerge(pull, "Antonio20045")]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.stdout, /^keine solchen PRs/m);
});

test("Rot-Proben: --ohne-menschen übergeht einen PR, der vor mehr als sieben Tagen gemergt wurde", async (context) => {
  const pull = gemergt(ERSTE_PROBE, { tage: ACHT_TAGE });
  const lauf = await ohneMenschen(context, [pull], [approveVorMerge(pull)]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.stdout, /^keine solchen PRs/m);
});

function allesGestoppt() {
  const schritte = [
    { lauf: PRUEFUNGEN_LAUF, schritt: "ESLint-Konfiguration, Unterordner und only prüfen" },
    { lauf: TESTSCHUTZ_LAUF, schritt: "Bestehende Tests nur ergänzt" },
  ];
  const aufnahme = schritte.reduce(mitSchritt, lintRot(mitTyppruefung(AUFNAHME, "failure")));
  const pflicht = new Set(["Prüfungen prüfen", "Testschutz"]);
  const checks = aufnahme.checks.map((check) => (pflicht.has(check.name) ? { ...check, conclusion: "failure" } : check));
  return { ...aufnahme, checks };
}

function nachgebautesGh(ordner) {
  const nummern = Object.fromEntries(FAELLE.map((fall, index) => [`rotprobe/20-${fall}`, ERSTE_PROBE + index]));
  const bin = join(ordner, "bin");
  mkdirSync(bin);
  const skript = [
    "#!/usr/bin/env node",
    `const nummern = ${JSON.stringify(nummern)};`,
    'const kopf = process.argv[process.argv.indexOf("--head") + 1];',
    "console.log(`https://github.com/sundartha/hermes/pull/${nummern[kopf]}`);",
    "",
  ].join("\n");
  writeFileSync(join(bin, "gh"), skript);
  chmodSync(join(bin, "gh"), AUSFUEHRBAR);
  return bin;
}

test("Rot-Proben: der volle Lauf legt sieben Proben an, prüft den Push, wertet aus und räumt auf", async (context) => {
  const { arbeit, nackt } = upstreamMit(context, NUR_MASTER_HAKEN);
  gitIn(arbeit, ["remote", "set-url", "upstream", "https://github.com/sundartha/hermes.git"]);
  gitIn(arbeit, ["remote", "set-url", "--push", "upstream", nackt]);
  const pulls = new Map(FAELLE.map((fall, index) => [ERSTE_PROBE + index, AUFNAHME.pr]));
  const api = await nachgebauteApi(context, zustandAus(allesGestoppt(), { pulls }));
  const bin = nachgebautesGh(probeDirectory(context, {}));
  const PATH = `${bin}${delimiter}${process.env.PATH}`;
  const lauf = await werkzeug([], { cwd: arbeit, umgebung: { ...api.umgebung, PATH } });
  assert.equal(lauf.status, EXIT_OK, `${lauf.stdout}\n${lauf.stderr}`);
  for (const [index, fall] of FAELLE.entries()) {
    assert.match(lauf.stdout, new RegExp(`^\\| ${fall} \\| #${ERSTE_PROBE + index} \\| .* \\| gestoppt \\|$`, "m"));
    assert.equal(gitIn(nackt, ["rev-list", "--count", `master..rotprobe/20-${fall}`]), "1");
  }
  assert.match(lauf.stdout, /^Push-Probe \(push-auf-master\): gestoppt/m);
  assert.match(lauf.stdout, /^keine solchen PRs/m);
  const geloescht = api.anfragen.filter(({ methode }) => methode === "DELETE");
  assert.equal(geloescht.length, FAELLE.length + FAELLE.length);
  assert.equal(gitIn(arbeit, ["branch", "--show-current"]), "arbeit");
  assert.equal(gitIn(arbeit, ["status", "--porcelain"]), "");
});

const VORLAGE_ANKER = 'assert.equal(findPlan("nope"), null);';
const VORLAGE_TEST = `test("Plan", () => {\n  ${VORLAGE_ANKER}\n});\n`;
const OHNE_VORLAGE = Object.fromEntries(Object.entries(ANKERDATEIEN).filter(([datei]) => !datei.startsWith("test/") || TS_VORLAGEN.includes(datei)));

async function umgeschriebenerTestPatch(context, dateien) {
  const { arbeit, ordner, lauf } = await nurPatchesIn(context, { ...OHNE_VORLAGE, ...dateien });
  const patch = join(ordner, "umgeschriebener-test.patch");
  return { arbeit, lauf, patch };
}

const VORLAGE_NEUER_PFAD = "test/abrechnung/tarifkatalog.test.js";
const VORLAGE_FRUEH = "test/abrechnung/frueher.test.js";
const VORLAGE_SPAET = "test/zzz/spaeter.test.js";
const VORLAGE_UNGESCHUETZT = "test/werkzeuge/anker.test.js";

async function pruefeVorlage(context, dateien, erwartet) {
  const { arbeit, lauf, patch } = await umgeschriebenerTestPatch(context, dateien);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(readFileSync(patch, "utf8"), new RegExp(`^\\+\\+\\+ b/${erwartet}$`, "m"));
  assert.equal(runIn(arbeit, "git", ["apply", "--check", patch]).status, EXIT_OK);
  assert.equal(gitIn(arbeit, ["status", "--porcelain"]), "");
}

test("Rot-Proben: umgeschriebener-test nimmt die Vorlage unter ihrem neuen Pfad", (context) =>
  pruefeVorlage(context, { [VORLAGE_NEUER_PFAD]: VORLAGE_TEST }, VORLAGE_NEUER_PFAD));

test("Rot-Proben: umgeschriebener-test nimmt bei mehreren Treffern die nach Pfad erste", (context) =>
  pruefeVorlage(context, { [VORLAGE_SPAET]: VORLAGE_TEST, [VORLAGE_FRUEH]: VORLAGE_TEST }, VORLAGE_FRUEH));

test("Rot-Proben: umgeschriebener-test nimmt nicht den Treffer unter test/werkzeuge, den der Testschutz nicht schützt", (context) =>
  pruefeVorlage(context, { [VORLAGE_UNGESCHUETZT]: VORLAGE_TEST, [VORLAGE_SPAET]: VORLAGE_TEST }, VORLAGE_SPAET));

test("Rot-Proben: umgeschriebener-test meldet laut, wenn keine geschützte Testdatei die Vorlagenzeile enthält", async (context) => {
  const dateien = { [VORLAGE_UNGESCHUETZT]: VORLAGE_TEST, "test/abrechnung/anderes.test.js": "// nichts\n" };
  const { arbeit, lauf } = await umgeschriebenerTestPatch(context, dateien);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^umgeschriebener-test: nicht erzeugbar: keine Testdatei unter test\/ enthält assert\.equal\(findPlan\("nope"\), null\);$/m);
  assert.match(lauf.stdout, /^- umgeschriebener-test: nicht erzeugbar: keine Testdatei/m);
  assert.match(lauf.stdout, /^- lint-fehler: .*lint-fehler\.patch$/m);
  assert.equal(gitIn(arbeit, ["status", "--porcelain"]), "");
});
