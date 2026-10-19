import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, probeRepository, runIn } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/wochenbericht.mjs");
const { probelauf: AUFNAHME } = JSON.parse(
  readFileSync(join(REPO_ROOT, "test/werkzeuge/wochenbericht-aufzeichnung.json"), "utf8"),
);
const OBERGRENZE = 137;
const REPO = "/repos/sundartha/hermes";
const STANDARD_SEITE = 30;
const KOPF = "<kopf>";
const ERFOLG = 200;
const NICHT_GEFUNDEN = 404;
const SEITEN_PARAMETER = new Set(["page", "per_page"]);
const BUDGET = { monatsMinuten: 3000, minutenJeLauf: { Prüfer: 15, Wochenbericht: 5 }, verzicht: ["Prüfer"] };
const UHR = `data:text/javascript,${encodeURIComponent(
  `const jetzt = Date.parse(${JSON.stringify(AUFNAHME.jetzt)});
globalThis.Date = class extends Date {
  constructor(...werte) { super(...(werte.length === 0 ? [jetzt] : werte)); }
  static now() { return jetzt; }
};`,
)}`;

function seite(url, liste) {
  const groesse = Number(url.searchParams.get("per_page") ?? STANDARD_SEITE);
  const nummer = Number(url.searchParams.get("page") ?? 1);
  return liste.slice((nummer - 1) * groesse, nummer * groesse);
}

function laeufe(url, liste) {
  const filter = ["event", "status", "head_sha"].filter((name) => url.searchParams.has(name));
  const passend = liste.filter((lauf) => filter.every((name) => lauf[name] === url.searchParams.get(name)));
  const mitAdresse = (lauf) => ({ ...lauf, html_url: `https://github.com/sundartha/hermes/actions/runs/${lauf.id}` });
  return { total_count: passend.length, workflow_runs: seite(url, passend).map(mitAdresse) };
}

function issues(url) {
  if (url.searchParams.get("labels") === "entscheidung") return AUFNAHME.entscheidungen;
  if (url.searchParams.get("labels") === "pruefer") return AUFNAHME.prueferIssues;
  return AUFNAHME.automatisch;
}

function jobs(url, lauf) {
  const liste = AUFNAHME.jobs[lauf] ?? [];
  return { total_count: liste.length, jobs: seite(url, liste) };
}

const ROUTEN = [
  [/^\/actions\/workflows$/, () => ({ total_count: AUFNAHME.workflows.length, workflows: AUFNAHME.workflows })],
  [/^\/actions\/workflows\/(\d+)\/runs$/, (url, id) => laeufe(url, AUFNAHME.laeufe.filter((lauf) => lauf.workflow_id === Number(id)))],
  [/^\/actions\/runs\/(\d+)\/jobs$/, jobs],
  [/^\/actions\/runs$/, (url) => laeufe(url, AUFNAHME.laeufe)],
  [/^\/pulls\/(\d+)$/, (url, nummer) => ({ number: Number(nummer), merged_by: { login: AUFNAHME.gemergtVon[nummer] } })],
  [/^\/pulls$/, (url) => seite(url, AUFNAHME.pulls)],
  [/^\/issues\/(\d+)\/comments$/, (url, nummer) => seite(url, AUFNAHME.kommentare[nummer] ?? [])],
  [/^\/issues\/(\d+)\/events$/, (url, nummer) => seite(url, AUFNAHME.ereignisse[nummer] ?? [])],
  [/^\/issues\/comments$/, (url) => seite(url, AUFNAHME.issueKommentare)],
  [/^\/issues$/, (url) => seite(url, issues(url))],
  [/^\/commits$/, (url) => seite(url, AUFNAHME.commits)],
];

function suche(url) {
  if (!url.searchParams.get("q").includes("-reviewed-by:")) return { total_count: AUFNAHME.gemergt, items: [] };
  return { total_count: AUFNAHME.ohneReview.length, items: AUFNAHME.ohneReview };
}

function antwortAuf(url) {
  if (url.pathname === "/search/issues") return suche(url);
  if (!url.pathname.startsWith(REPO)) return undefined;
  const pfad = url.pathname.slice(REPO.length);
  for (const [muster, antwort] of ROUTEN) {
    const treffer = muster.exec(pfad);
    if (treffer !== null) return antwort(url, treffer[1]);
  }
  return undefined;
}

function graphql(text) {
  const { variables } = JSON.parse(text);
  const passend = variables.text === `repo:sundartha/hermes ${AUFNAHME.ohneReviewSuche}`;
  const gefunden = passend ? AUFNAHME.ohneReview.slice(0, -1) : [];
  const knoten = gefunden.map(({ number }) => ({ number, mergedBy: { login: AUFNAHME.gemergtVon[number].replace("[bot]", "") } }));
  return { data: { search: { nodes: knoten.slice(0, variables.first) } } };
}

function inhaltZu(anfrage, url, text) {
  if (anfrage.method === "POST" && url.pathname === "/graphql") return graphql(text);
  return anfrage.method === "GET" ? antwortAuf(url) : undefined;
}

function endpunkt(methode, url) {
  const namen = [...url.searchParams.keys()];
  const parameter = namen.filter((name) => !SEITEN_PARAMETER.has(name)).sort();
  return `${methode} ${url.pathname.replaceAll(/\/\d+/g, "/{n}")}${parameter.length > 0 ? `?${parameter.join("&")}` : ""}`;
}

async function attrappe(context) {
  const aufrufe = new Map();
  const server = createServer((anfrage, antwort) => {
    const url = new URL(anfrage.url, "http://localhost");
    const name = endpunkt(anfrage.method, url);
    aufrufe.set(name, (aufrufe.get(name) ?? 0) + 1);
    let text = "";
    anfrage.on("data", (stueck) => (text += stueck));
    anfrage.on("end", () => {
      const inhalt = inhaltZu(anfrage, url, text);
      antwort.writeHead(inhalt === undefined ? NICHT_GEFUNDEN : ERFOLG, { "content-type": "application/json" });
      antwort.end(JSON.stringify(inhalt ?? { message: "Not Found" }));
    });
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  context.after(() => server.close());
  return { aufrufe, adresse: `http://127.0.0.1:${server.address().port}` };
}

async function probelauf(context) {
  const { aufrufe, adresse } = await attrappe(context);
  const ordner = probeRepository(context, {
    "tools/systemstand.mjs": 'console.log("Schritt 1: Probe");\n',
    ".github/budget.json": JSON.stringify(BUDGET),
  });
  const datei = join(ordner, "bericht.md");
  const env = { ...isolatedEnvironment(), GITHUB_API_URL: adresse, GITHUB_REPOSITORY: "sundartha/hermes", GH_TOKEN: "probe" };
  const ausgabe = await new Promise((fertig) =>
    execFile(process.execPath, ["--import", UHR, TOOL, "--probe", "--datei", datei], { cwd: ordner, env }, (fehler, stdout, stderr) =>
      fertig({ status: fehler?.code ?? 0, stderr }),
    ),
  );
  assert.equal(ausgabe.status, 0, ausgabe.stderr);
  const kopf = runIn(ordner, "git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  return { aufrufe, bericht: readFileSync(datei, "utf8").replace(`Commit ${kopf}.`, `Commit ${KOPF}.`) };
}

test("Wochenbericht: ein Probe-Lauf der Aufnahme kommt mit wenigen GitHub-Aufrufen aus", async (context) => {
  const { aufrufe } = await probelauf(context);
  const gesamt = [...aufrufe.values()].reduce((summe, zahl) => summe + zahl, 0);
  const tabelle = [...aufrufe].sort(([, links], [, rechts]) => rechts - links).map(([name, zahl]) => `${zahl} ${name}`);
  assert.ok(gesamt <= OBERGRENZE, `${gesamt} Aufrufe statt höchstens ${OBERGRENZE}:\n${tabelle.join("\n")}`);
});

test("Wochenbericht: der Bericht der Aufnahme bleibt Zeichen für Zeichen gleich", async (context) => {
  const { bericht } = await probelauf(context);
  assert.equal(bericht, AUFNAHME.bericht.join("\n"));
});
