import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import { ausgang, auswegBei } from "../../tools/auftrag/ausgang.mjs";
import { incentiveSection } from "../../tools/wochenbericht/anreize.mjs";
import { raiseEmptyLists, transitionLists, transitionSection } from "../../tools/wochenbericht/uebergang.mjs";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, isolatedEnvironment, probeDirectory } from "./probe-repo.js";

const JETZT = new Date("2026-10-12T05:23:00Z");
const IN_DER_WOCHE = "2026-10-08T10:00:00Z";
const VOR_DER_WOCHE = "2026-09-30T10:00:00Z";
const OBERGRENZE = 25;
const WOCHENBERICHT = join(REPO_ROOT, "tools/wochenbericht.mjs");
const NACHTLAUF = { id: 7, name: "Nachtlauf" };
const ROTER_LAUF = { conclusion: "failure", created_at: IN_DER_WOCHE, html_url: "https://github.com/sundartha/hermes/actions/runs/1" };

async function attrappe(context, antworten) {
  const schreibvorgaenge = [];
  const server = createServer((anfrage, antwort) => {
    const url = new URL(anfrage.url, "http://localhost");
    let text = "";
    anfrage.on("data", (stueck) => (text += stueck));
    anfrage.on("end", () => {
      if (anfrage.method !== "GET") schreibvorgaenge.push({ pfad: url.pathname, inhalt: JSON.parse(text) });
      const liste = (url.searchParams.get("page") ?? "1") === "1" ? (antworten(url) ?? []) : [];
      antwort.setHeader("content-type", "application/json");
      antwort.end(JSON.stringify(anfrage.method === "GET" ? liste : { number: schreibvorgaenge.length, title: JSON.parse(text).title }));
    });
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  const vorher = { ...process.env };
  Object.assign(process.env, { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GH_TOKEN: "probe", GITHUB_REPOSITORY: "sundartha/hermes" });
  context.after(() => {
    server.close();
    for (const name of ["GITHUB_API_URL", "GH_TOKEN", "GITHUB_REPOSITORY"]) {
      if (vorher[name] === undefined) delete process.env[name];
      else process.env[name] = vorher[name];
    }
  });
  return schreibvorgaenge;
}

function listenOrdner(context) {
  return probeDirectory(context, {
    "tools/basis/knip.json": JSON.stringify({ befunde: ["exports|src/a.js|alt", "exports|src/b.js|weg"] }),
    "tools/basis/katalog-ohne-test.txt": "",
    "tools/basis/test-importe.json": JSON.stringify([{ from: "test/a.test.js", to: "src/a.js" }]),
    "eslint-suppressions.json": JSON.stringify({ "src/a.js": { complexity: { count: 2 }, "max-params": { count: 3 } } }),
  });
}

test("Wochenbericht: zeigt je Übergangsliste die Zahl ihrer Einträge, bei eslint-suppressions.json die unterdrückten Verstöße", (context) => {
  const listen = transitionLists(listenOrdner(context));
  assert.deepEqual(transitionSection(listen), [
    "- `tools/basis/knip.json`: 2 Einträge",
    "- `tools/basis/test-importe.json`: 1 Einträge",
    "- `tools/basis/katalog-ohne-test.txt`: 0 Einträge",
    "- `eslint-suppressions.json`: 5 unterdrückte Verstöße",
    "",
  ]);
});

test("Wochenbericht: legt für eine leere Übergangsliste ein Issue an, das nennt, was gelöscht wird, und nur einmal", async (context) => {
  const schreibvorgaenge = await attrappe(context, () => []);
  const leer = [{ path: "eslint-suppressions.json", count: 0 }, { path: "tools/basis/knip.json", count: 0 }, { path: "tools/basis/jscpd.json", count: 4 }];
  const offen = [{ title: "Übergangsliste leer: tools/basis/knip.json" }];
  await raiseEmptyLists(leer, offen, { limit: OBERGRENZE });
  assert.deepEqual(schreibvorgaenge.map(({ inhalt }) => inhalt.title), ["Übergangsliste leer: eslint-suppressions.json"]);
  const [{ inhalt }] = schreibvorgaenge;
  assert.match(inhalt.body, /^- scripts\/check-staged-suppressions\.js mit seinem Aufruf in \.githooks\/pre-commit/m);
  assert.match(inhalt.body, /^- der Schalter --pass-on-unpruned-suppressions in package\.json/m);
  assert.match(inhalt.body, /^- danach gilt schlicht eslint \. streng$/m);
});

test("Wochenbericht: legt kein Issue für eine leere Liste an, wenn die Obergrenze offener Issues erreicht ist", async (context) => {
  const schreibvorgaenge = await attrappe(context, () => []);
  const offen = Array.from({ length: OBERGRENZE }, (_wert, nummer) => ({ title: `Offen ${nummer}` }));
  await raiseEmptyLists([{ path: "tools/basis/knip.json", count: 0 }], offen, { limit: OBERGRENZE });
  assert.deepEqual(schreibvorgaenge, []);
});

function antwortenBeiObergrenze(url) {
  if (url.pathname.endsWith("/actions/workflows")) return { workflows: [NACHTLAUF] };
  if (url.pathname.endsWith(`/actions/workflows/${NACHTLAUF.id}/runs`)) return { workflow_runs: [ROTER_LAUF, ROTER_LAUF, ROTER_LAUF] };
  if (url.pathname.endsWith("/issues") && url.searchParams.has("creator")) return Array.from({ length: OBERGRENZE }, (_wert, nummer) => ({ title: `Offen ${nummer}` }));
  return [];
}

function alarmeIn(ordner) {
  return new Promise((fertig) => execFile(process.execPath, [WOCHENBERICHT, "--alarme"], { cwd: ordner, env: isolatedEnvironment() }, (fehler, _ausgabe, stderr) => fertig({ status: fehler?.code ?? 0, stderr })));
}

test("Wochenbericht: bei erreichter Obergrenze melden roter Lauf und leere Übergangsliste dieselbe Zeile und legen nichts an", async (context) => {
  const schreibvorgaenge = await attrappe(context, antwortenBeiObergrenze);
  const ordner = probeDirectory(context, { "tools/basis/knip.json": JSON.stringify({ befunde: [] }) });
  const { status, stderr } = await alarmeIn(ordner);
  assert.equal(status, 0);
  assert.deepEqual(stderr.split("\n").filter((zeile) => zeile.startsWith("Obergrenze")), [
    `Obergrenze von ${OBERGRENZE} offenen Issues erreicht; „Geplanter Lauf dreimal hintereinander rot: Nachtlauf“ fehlt.`,
    `Obergrenze von ${OBERGRENZE} offenen Issues erreicht; „Übergangsliste leer: tools/basis/knip.json“ fehlt.`,
  ]);
  assert.deepEqual(schreibvorgaenge, []);
});

function antwortenFuerAnreize(url) {
  if (url.pathname.endsWith("/commits")) {
    return [
      { commit: { message: "Baue um\n\nWarum: x\n\nGleichwertig: a.js:3 > zu >=, weil die Grenze nie erreicht wird\nGleichwertig: a.js:9 + zu -, weil null addiert wird\nPaket: AN1" } },
      { commit: { message: "Ändere b\n\nWarum: y\n\nGleichwertig: ohne Begründung\nPaket: AN1" } },
      { commit: { message: `Schneide den Auftrag a1 neu\n\nWarum: Der Agent ist ausgestiegen.\n\nAuftrag passt nicht: x\n${auswegBei(["lint"])}\n\nAuftrag: P-001/a1` } },
      { commit: { message: `Schneide den Auftrag a2 neu\n\nWarum: Der Agent ist ausgestiegen.\n\nAuftrag passt nicht: y\n${auswegBei(["lint", "typprüfung"])}\n\nAuftrag: P-001/a2` } },
    ];
  }
  if (url.pathname.endsWith("/issues/comments")) {
    return [
      { created_at: IN_DER_WOCHE, body: "## Entscheidung nötig\n\nAuftrag passt nicht: Der Abnahmetest prüft das Gegenteil des Ziels." },
      { created_at: VOR_DER_WOCHE, body: "Auftrag passt nicht: alt" },
      { created_at: IN_DER_WOCHE, body: "Voraussetzung fehlt: Altfunktionen aufräumen: src/a.js:rechne" },
      { created_at: IN_DER_WOCHE, body: `## Entscheidung nötig\n\nAlter Test hält altes Verhalten fest: test/a.test.js:alt – neu\n${auswegBei(["betroffene tests"])}` },
      { created_at: VOR_DER_WOCHE, body: auswegBei(["lint"]) },
    ];
  }
  if (url.pathname.endsWith("/issues/11/events")) return [{ event: "closed", commit_id: "a".repeat(40) }];
  if (url.pathname.endsWith("/issues/12/events")) return [{ event: "closed", commit_id: null }];
  if (url.pathname.endsWith("/issues") && url.searchParams.get("labels") === "pruefer") {
    return [
      { number: 11, closed_at: IN_DER_WOCHE },
      { number: 12, closed_at: IN_DER_WOCHE },
      { number: 13, closed_at: VOR_DER_WOCHE },
      { number: 14, closed_at: IN_DER_WOCHE, pull_request: {} },
    ];
  }
  return [];
}

test("Wochenbericht: zählt angenommene Gleichwertig-Meldungen, Ausstiege „Auftrag passt nicht“ und Prüfer-Issues mit und ohne Änderung", async (context) => {
  await attrappe(context, antwortenFuerAnreize);
  assert.deepEqual(await incentiveSection(JETZT), [
    "- Angenommene Gleichwertig-Meldungen in Commits auf master: 2",
    "- Ausstiege „Auftrag passt nicht“ in Kommentaren: 1",
    "- Ausstiege je Prüfung: lint 2, betroffene tests 1, typprüfung 1",
    "- Alter Test hält altes Verhalten fest: 1",
    "- Geschlossene Prüfer-Issues: 1 mit einer Änderung, 1 ohne Änderung",
    "",
  ]);
});

const GRUND = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
const AUSWEG_ZAEHLUNG = /^- (?:Ausstiege|Alter Test)/;

async function berichtZuKommentaren(context, ...koerper) {
  await attrappe(context, (url) => (url.pathname.endsWith("/issues/comments") ? koerper.map((body) => ({ created_at: IN_DER_WOCHE, body })) : []));
  return (await incentiveSection(JETZT)).filter((zeile) => AUSWEG_ZAEHLUNG.test(zeile));
}

test("Wochenbericht: zählt jede Prüfung aus den Ausweg-Zeilen, die auswegBei schreibt, mit mehreren Prüfungen und ohne rote Prüfung", async (context) => {
  const bericht = await berichtZuKommentaren(context, `## Entscheidung nötig\n\n${auswegBei(["lint", "typprüfung"])}`, auswegBei(["betroffene tests"]), auswegBei([]));
  assert.deepEqual(bericht, ["- Ausstiege „Auftrag passt nicht“ in Kommentaren: 0", "- Ausstiege je Prüfung: betroffene tests 1, keine 1, lint 1, typprüfung 1", "- Alter Test hält altes Verhalten fest: 0"]);
});

test("Wochenbericht: zählt die Zeilen als Ausstieg und als alten Test, die ausgang in einer Antwort des Agenten erkennt", async (context) => {
  const ausstieg = ausgang(`Ich höre auf.\nAuftrag passt nicht: ${GRUND}`, "bau").zeile;
  const alterTest = ausgang("Alter Test hält altes Verhalten fest: test/a.test.js:alt – neu", "bau").zeile;
  const bericht = await berichtZuKommentaren(context, ausstieg, alterTest);
  assert.deepEqual(bericht, ["- Ausstiege „Auftrag passt nicht“ in Kommentaren: 1", "- Ausstiege je Prüfung: 0", "- Alter Test hält altes Verhalten fest: 1"]);
});

test("Wochenbericht: zählt den Ausstieg und die Prüfung aus dem Kommentar, den der Auftragsweg bei einem Ausstieg schreibt", async (context) => {
  const drehbuch = { "bau-antwort": `Ich höre auf.\nAuftrag passt nicht: ${GRUND}`, "notiz-antwort": "1. Entwurf klären" };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const bericht = await berichtZuKommentaren(context, beleg.entscheidung.text);
  assert.deepEqual(bericht, ["- Ausstiege „Auftrag passt nicht“ in Kommentaren: 1", "- Ausstiege je Prüfung: keine 1", "- Alter Test hält altes Verhalten fest: 0"]);
});

test("Wochenbericht: zählt eine Ausstiegs- und eine Alter-Test-Zeile mit jedem Leerraum nach dem Doppelpunkt, den ausgang erkennt", async (context) => {
  const ausstiege = ["Auftrag passt nicht:Grund", "Auftrag passt nicht:   Grund", "Auftrag passt nicht:\tGrund"];
  const alteTests = ["Alter Test hält altes Verhalten fest:test/a.test.js:alt – neu", "Alter Test hält altes Verhalten fest:   test/a.test.js:alt – neu"];
  const erkannt = [...ausstiege, ...alteTests].map((zeile) => ausgang(zeile, "bau").zeile);
  assert.deepEqual(erkannt, [...ausstiege, ...alteTests]);
  const bericht = await berichtZuKommentaren(context, ...erkannt);
  assert.deepEqual(bericht, ["- Ausstiege „Auftrag passt nicht“ in Kommentaren: 3", "- Ausstiege je Prüfung: 0", "- Alter Test hält altes Verhalten fest: 2"]);
});

test("Wochenbericht: zählt eine Ausstiegs- und eine Alter-Test-Zeile hinter jedem Zeilenende, das ausgang als Zeilenende erkennt", async (context) => {
  const ausstieg = `Auftrag passt nicht: ${GRUND}`;
  const alterTest = "Alter Test hält altes Verhalten fest: test/a.test.js:alt – neu";
  const antworten = ["\r\n", "\r", "\u2028"].map((ende) => `Ich höre auf.${ende}${ausstieg}${ende}${alterTest}${ende}`);
  assert.deepEqual(antworten.map((antwort) => ausgang(antwort, "bau").zeile), [alterTest, alterTest, alterTest]);
  const bericht = await berichtZuKommentaren(context, ...antworten);
  assert.deepEqual(bericht, ["- Ausstiege „Auftrag passt nicht“ in Kommentaren: 3", "- Ausstiege je Prüfung: 0", "- Alter Test hält altes Verhalten fest: 3"]);
});
