import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  writeFiles,
} from "../probe-repo.js";

export const ZIELE = join(REPO_ROOT, "tools/ziele.mjs");
const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
export const REPO = "sundartha/hermes";
export const LAUF = "4242";
export const BOT = "sundartha-agent[bot]";
export const AKTIONEN = { login: "github-actions[bot]" };
const HTTP_OK = 200;
const HTTP_ANGELEGT = 201;
const HTTP_FEHLT = 404;
const ERSTE_NUMMER = 500;
const AUSFUEHRBAR = 0o755;
const SEKUNDE_MS = 1000;
const SHA_LAENGE = 40;
const GRUNDZEIT = Date.parse("2026-10-01T00:00:00Z");

export function zeitpunkt(sekunden) {
  return new Date(GRUNDZEIT + sekunden * SEKUNDE_MS).toISOString();
}

export const GRUNDDATEIEN = {
  ".gitignore": "node_modules\n",
  "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test", "test:mutation": 'node -e "" --' } }),
  "knip.json": JSON.stringify({ entry: ["src/main.js"], project: ["src/**/*.js"] }),
  ".jscpd.json": JSON.stringify({ minTokens: 20, minLines: 2, format: ["javascript"], ignore: ["**/node_modules/**"] }),
  "eslint.config.js": 'export default [{ rules: { "no-unused-vars": "warn", "no-var": "error" } }];\n',
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n/.github/ @Antonio20045\n",
  ".github/budget.json": JSON.stringify({ minutenJeLauf: { Aufräumen: 10, Auswertung: 10 } }),
  "tools/gate-tests.json": JSON.stringify({ Probe: { module: ["src/gate.js"], tests: [] } }),
  "tools/ziele/geschuetzt.json": JSON.stringify({ gates: "tools/gate-tests.json", abrechnung: ["src/abrechnung/"], gespraech: ["src/gespraech/"], erzeugt: ["src/erzeugt.js"] }),
};

export function quelltext(zeilen) {
  return `${zeilen.join("\n")}\n`;
}

export function git(ordner, argumente, zusatz = {}) {
  const lauf = spawnSync("git", argumente, { cwd: ordner, encoding: "utf8", env: { ...isolatedEnvironment(), ...zusatz } });
  if (lauf.status !== 0) throw new Error(`git ${argumente.join(" ")}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

function legeBasislinienAn(ordner) {
  for (const werkzeug of ["knip", "jscpd"]) {
    const lauf = spawnSync(process.execPath, [BASIS_VERGLEICH, werkzeug, "--basis-anlegen"], { cwd: ordner, encoding: "utf8", env: isolatedEnvironment() });
    if (lauf.status !== 0) throw new Error(`basis-vergleich ${werkzeug}: ${lauf.stderr}`);
  }
  commitAll(ordner, "Basislinien");
}

export function zieleRepo(context, dateien) {
  const ordner = probeRepository(context, { ...GRUNDDATEIEN, ...dateien });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(ordner, "node_modules"));
  legeBasislinienAn(ordner);
  const kopf = () => git(ordner, ["rev-parse", "HEAD"]);
  return {
    ordner,
    sha: kopf,
    committe(neu, nachricht = "Änderung") {
      writeFiles(ordner, neu);
      commitAll(ordner, nachricht);
      return kopf();
    },
    committeAm(neu, { nachricht, datum }) {
      writeFiles(ordner, neu);
      git(ordner, ["add", "."]);
      git(ordner, ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-q", "-m", nachricht], { GIT_COMMITTER_DATE: datum, GIT_AUTHOR_DATE: datum });
      return kopf();
    },
  };
}

export function mitUrsprung(context, repo) {
  const ursprung = probeDirectory(context, {});
  git(ursprung, ["init", "-q", "--bare"]);
  git(repo.ordner, ["remote", "add", "origin", ursprung]);
  return ursprung;
}

const STANDARD_SEITE = 30;

function seite(liste, abfrage) {
  const groesse = Number(abfrage.get("per_page") ?? STANDARD_SEITE);
  const beginn = (Number(abfrage.get("page") ?? 1) - 1) * groesse;
  return liste.slice(beginn, beginn + groesse);
}

function mitLabel(issue, abfrage) {
  const gewuenscht = abfrage.get("labels");
  return gewuenscht === null || issue.labels.some(({ name }) => name === gewuenscht);
}

function imZustand(eintrag, abfrage) {
  const zustand = abfrage.get("state") ?? "open";
  return zustand === "all" || eintrag.state === zustand;
}

function passendeLaeufe(laeufe, abfrage) {
  return laeufe.filter((lauf) =>
    ["status", "event", "head_sha"].every((feld) => abfrage.get(feld) === null || lauf[feld] === abfrage.get(feld)),
  );
}

function issueAnlegen(zustand, rumpf) {
  const nummer = zustand.naechste();
  const issue = {
    number: nummer,
    title: rumpf.title,
    body: rumpf.body ?? "",
    labels: (rumpf.labels ?? []).map((name) => ({ name })),
    state: "open",
    state_reason: null,
    comments: 0,
    created_at: new Date().toISOString(),
    closed_at: null,
    user: AKTIONEN,
    html_url: `https://github.com/${REPO}/issues/${nummer}`,
  };
  zustand.issues.push(issue);
  return issue;
}

function issueAendern(zustand, nummer, rumpf) {
  const issue = zustand.issues.find((eintrag) => eintrag.number === nummer);
  if (rumpf.state === "open" && issue.state === "closed") {
    zustand.ereignisse.push({ nummer, event: "reopened", created_at: new Date().toISOString() });
  }
  Object.assign(issue, rumpf, rumpf.state === "closed" ? { closed_at: new Date().toISOString() } : {});
  return issue;
}

function kommentieren(zustand, nummer, rumpf) {
  const issue = zustand.issues.find((eintrag) => eintrag.number === nummer);
  if (issue) issue.comments += 1;
  const kommentar = { nummer, body: rumpf.body, user: AKTIONEN, created_at: new Date().toISOString(), html_url: `${issue?.html_url ?? ""}#c${zustand.kommentare.length}` };
  zustand.kommentare.push(kommentar);
  return kommentar;
}

function prAnlegen(zustand, rumpf) {
  const nummer = zustand.naechste();
  const pr = { number: nummer, ...rumpf, state: "open", html_url: `https://github.com/${REPO}/pull/${nummer}` };
  zustand.angelegtePrs.push(pr);
  return pr;
}

const ROUTEN = [
  ["GET", /^\/issues$/, (zustand, { abfrage }) => zustand.issues.filter((issue) => mitLabel(issue, abfrage) && imZustand(issue, abfrage))],
  ["POST", /^\/issues$/, (zustand, { rumpf }) => issueAnlegen(zustand, rumpf)],
  ["PATCH", /^\/issues\/(\d+)$/, (zustand, { teile, rumpf }) => issueAendern(zustand, Number(teile[1]), rumpf)],
  ["GET", /^\/issues\/(\d+)\/comments$/, (zustand, { teile }) => zustand.kommentare.filter(({ nummer }) => nummer === Number(teile[1]))],
  ["POST", /^\/issues\/(\d+)\/comments$/, (zustand, { teile, rumpf }) => kommentieren(zustand, Number(teile[1]), rumpf)],
  ["GET", /^\/issues\/(\d+)\/events$/, (zustand, { teile }) => zustand.ereignisse.filter(({ nummer }) => nummer === Number(teile[1]))],
  ["GET", /^\/labels\/(.+)$/, (zustand, { teile }) => (zustand.labels.has(decodeURIComponent(teile[1])) ? { name: teile[1] } : null)],
  ["POST", /^\/labels$/, (zustand, { rumpf }) => zustand.labels.add(rumpf.name) && rumpf],
  ["GET", /^\/pulls$/, (zustand, { abfrage }) => zustand.pulls.filter((pr) => imZustand(pr, abfrage))],
  ["POST", /^\/pulls$/, (zustand, { rumpf }) => prAnlegen(zustand, rumpf)],
  ["PATCH", /^\/pulls\/(\d+)$/, (zustand, { teile, rumpf }) => Object.assign(zustand.pulls.find((pr) => pr.number === Number(teile[1])), rumpf)],
  ["GET", /^\/commits\/([0-9a-f]+)\/pulls$/, (zustand, { teile }) => zustand.commitPrs[teile[1]] ?? []],
  ["GET", /^\/actions\/workflows\/([\w.-]+)\/runs$/, (zustand, { teile, abfrage }) => ({ workflow_runs: passendeLaeufe(zustand.laeufe[teile[1]] ?? [], abfrage) })],
  ["GET", /^\/actions\/runs\/(\d+)\/jobs$/, (zustand, { teile }) => ({ jobs: jobsDes(zustand, teile[1]) })],
  ["GET", /^\/commits\/([0-9a-f]+)\/status$/, (zustand, { teile }) => ({ statuses: zustand.status[teile[1]] ?? [] })],
  ["GET", /^\/actions\/runs$/, (zustand, { abfrage }) => ({ workflow_runs: passendeLaeufe(Object.values(zustand.laeufe).flat(), abfrage) })],
];

function jobsDes({ laeufe }, nummer) {
  const lauf = Object.values(laeufe).flat().find(({ id }) => String(id) === nummer);
  return lauf?.jobs ?? [];
}

function antworte(zustand, anfrage) {
  const route = ROUTEN.find(([methode, muster]) => methode === anfrage.methode && muster.test(anfrage.pfad));
  if (route === undefined) return { status: HTTP_FEHLT, daten: { message: "Not Found" } };
  const [methode, muster, handlung] = route;
  const daten = handlung(zustand, { ...anfrage, teile: muster.exec(anfrage.pfad) });
  if (daten === null || daten === undefined) return { status: HTTP_FEHLT, daten: { message: "Not Found" } };
  const liste = Array.isArray(daten) ? seite(daten, anfrage.abfrage) : daten;
  return { status: methode === "POST" ? HTTP_ANGELEGT : HTTP_OK, daten: liste };
}

async function gelesenerRumpf(eingang) {
  const stuecke = [];
  for await (const stueck of eingang) stuecke.push(stueck);
  const text = Buffer.concat(stuecke).toString("utf8");
  return text === "" ? {} : JSON.parse(text);
}

function anfrageAus(eingang, rumpf) {
  const adresse = new URL(eingang.url, "http://attrappe");
  const pfad = adresse.pathname.replace(`/repos/${REPO}`, "");
  return { methode: eingang.method, pfad, abfrage: adresse.searchParams, rumpf };
}

export async function githubAttrappe(context, anfang = {}) {
  let nummer = ERSTE_NUMMER;
  const zustand = {
    naechste: () => (nummer += 1),
    issues: [],
    kommentare: [],
    ereignisse: [],
    labels: new Set(),
    pulls: [],
    angelegtePrs: [],
    commitPrs: {},
    laeufe: {},
    status: {},
    anfragen: [],
    anmeldungen: [],
    ...anfang,
  };
  const server = createServer(async (eingang, ausgang) => {
    const anfrage = anfrageAus(eingang, await gelesenerRumpf(eingang));
    zustand.anfragen.push(`${anfrage.methode} ${anfrage.pfad}`);
    zustand.anmeldungen.push(eingang.headers.authorization ?? "");
    const { status, daten } = antworte(zustand, anfrage);
    ausgang.writeHead(status, { "content-type": "application/json" });
    ausgang.end(JSON.stringify(daten));
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  context.after(() => server.close());
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, zustand };
}

export function umgebung(github, weitere = {}) {
  return {
    ...isolatedEnvironment(),
    GITHUB_API_URL: github.url,
    GITHUB_REPOSITORY: REPO,
    GH_TOKEN: "probe-token",
    GITHUB_RUN_ID: LAUF,
    GITHUB_OUTPUT: "",
    GITHUB_STEP_SUMMARY: "",
    ...weitere,
  };
}

async function ganzerText(strom) {
  let text = "";
  for await (const stueck of strom) text += stueck;
  return text;
}

export async function starteZiele(argumente, { cwd, env, programm = ZIELE }) {
  const kind = spawn(process.execPath, [programm, ...argumente], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const ende = once(kind, "close");
  const [stdout, stderr, [status]] = await Promise.all([ganzerText(kind.stdout), ganzerText(kind.stderr), ende]);
  return { status, stdout, stderr };
}

export function arbeitsordner(context, teile = {}) {
  const ordner = probeDirectory(context, {});
  for (const [pfad, inhalt] of Object.entries(teile)) {
    mkdirSync(join(ordner, pfad, ".."), { recursive: true });
    writeFileSync(join(ordner, pfad), typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt));
  }
  return ordner;
}

export function gelesen(ordner, pfad) {
  const datei = join(ordner, pfad);
  return existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null;
}

export function ersatzProgramm(context, quelle) {
  const ordner = probeDirectory(context, {});
  const programm = join(ordner, "ersatz.mjs");
  writeFileSync(programm, `#!/usr/bin/env node\n${quelle}\n`);
  chmodSync(programm, AUSFUEHRBAR);
  return { ordner, programm };
}

export function ersatzClaude(context, { schreibe = {}, antwort, protokoll = true, ergebnis = {} }) {
  const quelle = [
    'import { readFileSync, readdirSync, writeFileSync } from "node:fs";',
    `const schreibe = ${JSON.stringify(schreibe)};`,
    "for (const [pfad, inhalt] of Object.entries(schreibe)) writeFileSync(pfad, inhalt);",
    protokoll ? "writeFileSync(new URL('./protokoll.json', import.meta.url), JSON.stringify({ argumente: process.argv.slice(2), umgebung: process.env, ordner: process.cwd(), dateien: readdirSync('.', { recursive: true }).map(String).sort(), eingabe: readFileSync(0, 'utf8') }));" : "",
    `const ergebnis = { type: "result", subtype: "success", is_error: false, num_turns: 3, usage: { input_tokens: 10, output_tokens: 5 }, structured_output: ${JSON.stringify(antwort)}, ...${JSON.stringify(ergebnis)} };`,
    "process.stdout.write(`${JSON.stringify(ergebnis)}\\n`);",
  ].join("\n");
  const { ordner, programm } = ersatzProgramm(context, quelle);
  return { programm, protokoll: () => gelesen(ordner, "protokoll.json") };
}

export function ersatzGh(context) {
  const quelle = [
    'import { appendFileSync } from "node:fs";',
    "appendFileSync(new URL('./aufrufe.jsonl', import.meta.url), `${JSON.stringify({ argumente: process.argv.slice(2), token: process.env.GH_TOKEN ?? '' })}\\n`);",
  ].join("\n");
  const { ordner, programm } = ersatzProgramm(context, quelle);
  const gh = join(ordner, "gh");
  writeFileSync(gh, readFileSync(programm));
  chmodSync(gh, AUSFUEHRBAR);
  const aufrufe = () => {
    const datei = join(ordner, "aufrufe.jsonl");
    return existsSync(datei) ? readFileSync(datei, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile)) : [];
  };
  return { pfad: ordner, aufrufe };
}

export function eigenerPr(nummer, { sorte = "knip", datei = "src/frei.js", state = "open", kopf = "a".repeat(SHA_LAENGE), user = BOT } = {}) {
  return {
    number: nummer,
    title: `Aufräumen: ${sorte} in ${datei}`,
    state,
    merged_at: null,
    user: { login: user },
    head: { ref: `aufraeumen/${sorte}-${nummer}`, sha: kopf },
    closed_at: state === "closed" ? new Date().toISOString() : null,
    base: { sha: "b".repeat(SHA_LAENGE) },
    created_at: zeitpunkt(nummer),
  };
}

export function ciLauf(felder = {}) {
  return { path: ".github/workflows/ci.yml", event: "push", status: "completed", conclusion: "success", run_number: 1, head_branch: "master", head_repository: { full_name: REPO }, html_url: "https://github.com/sundartha/hermes/actions/runs/1", ...felder };
}

export function eigenerLauf(nummer, kopf, { schritt = "Ziel wählen", ergebnis = "success", ...felder } = {}) {
  return {
    id: nummer,
    head_sha: kopf,
    status: "completed",
    conclusion: "success",
    run_started_at: "2026-09-15T00:00:00Z",
    html_url: `https://github.com/${REPO}/actions/runs/${nummer}`,
    jobs: [{ steps: [{ name: "Vorprüfung", conclusion: "success" }, { name: schritt, conclusion: ergebnis }] }],
    ...felder,
  };
}

export function testFuer(...dateien) {
  const importe = dateien.map((datei, index) => `import * as m${index} from "../${datei}";`);
  return quelltext(['import assert from "node:assert/strict";', 'import { test } from "node:test";', ...importe, `test("erreicht", () => assert.ok([${dateien.map((_datei, index) => `m${index}`).join(", ")}]));`]);
}

export function ausgabenAus(datei) {
  const werte = {};
  for (const zeile of readFileSync(datei, "utf8").split("\n").filter(Boolean)) {
    const [name, ...wert] = zeile.split("=");
    werte[name] = wert.join("=");
  }
  return werte;
}

export function botIssue(nummer, titel, felder = {}) {
  return { number: nummer, title: titel, body: "", labels: [], state: "open", state_reason: null, comments: 0, created_at: zeitpunkt(0), closed_at: null, user: AKTIONEN, html_url: `https://github.com/${REPO}/issues/${nummer}`, ...felder };
}
