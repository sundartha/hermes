import assert from "node:assert/strict";
import { test } from "node:test";

import { echteQuellen, laufBefunde } from "../../tools/freigabe.mjs";

const KOPF = "a".repeat(40);
const ANDERER = "c".repeat(40);
const JETZT = Date.parse("2026-11-09T12:00:00Z");
const BRANCH = "dependabot/github_actions/klein";
const LOCK = "package-lock.json";
const WORKFLOW = ".github/workflows/ci.yml";
const AKTION = { [WORKFLOW]: [`      - uses: actions/checkout@${"1".repeat(40)}\n`, `      - uses: actions/checkout@${"2".repeat(40)}\n`] };
const NPM = { [LOCK]: [lockfile("8.1.0"), lockfile("8.1.1")] };

function vorTagen(tage) {
  return new Date(JETZT - tage * 86_400_000).toISOString();
}

function lockfile(version) {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "hermes", version: "1.0.0" }, "node_modules/ws": { version } } });
}

function pullVon(ref = BRANCH) {
  return { number: 42, head: { sha: KOPF, ref }, base: { ref: "master" }, title: "Update", user: { login: "dependabot[bot]" }, labels: [] };
}

function approve() {
  const urteil = ["PASS, kein MUSS-Befund.", "", "## Migrationsprüfung", "### actions/checkout", "Quelle: https://example.test/notes", "Auszug: Entfernt die alte API.", "Nutzung: git grep alteApi: kein Treffer", ""];
  return { user: { login: "Antonio20045" }, state: "APPROVED", commit_id: KOPF, body: urteil.join("\n") };
}

function quellenMit(ueberschreibt) {
  return {
    veroeffentlicht: async () => vorTagen(400),
    kopfGepusht: async () => vorTagen(400),
    ersterFix: async () => false,
    nodeLtsSeit: async () => vorTagen(400).slice(0, 10),
    queueEintraege: async () => [],
    liegtVor: async () => false,
    pull: async () => ({ head: { ref: "paket/fach" }, labels: [] }),
    offenePRs: async () => [],
    dateienVon: async () => [],
    notAus: async () => [],
    ...ueberschreibt,
  };
}

function lauf(stand, ueberschreibt) {
  const dateien = Object.keys(stand).map((pfad) => ({ status: "M", pfad }));
  const lesen = (ref, pfad) => stand[pfad]?.[ref === "basis" ? 0 : 1];
  return laufBefunde({ pull: pullVon(), reviews: [approve()], dateien, imQueue: true, basis: "basis", kopf: "kopf", lesen, jetzt: JETZT, quellen: quellenMit(ueberschreibt) });
}

function antwort(status, koerper) {
  return new Response(JSON.stringify(koerper), { status, headers: { "content-type": "application/json" } });
}

async function kopfGepusht(eintraege, status = 200) {
  const vorher = globalThis.fetch;
  const repoVorher = process.env.GITHUB_REPOSITORY;
  const gefragt = [];
  process.env.GITHUB_REPOSITORY = "o/r";
  globalThis.fetch = async (adresse) => {
    gefragt.push(String(adresse));
    return antwort(status, eintraege);
  };
  try {
    const zeit = await echteQuellen(pullVon(), "d".repeat(40)).kopfGepusht();
    return { zeit, gefragt };
  } finally {
    globalThis.fetch = vorher;
    if (repoVorher === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = repoVorher;
  }
}

test("ein altes Action-Release mit vor drei Tagen gepushtem PR-Kopf wartet noch", async () => {
  const befunde = await lauf(AKTION, { kopfGepusht: async () => vorTagen(3) });
  assert.deepEqual(befunde, [`Update-PR: actions/checkout ${"2".repeat(40)} ist jünger als 14 Tage.`]);
});

test("ohne Push-Zeitpunkt des PR-Kopfs ist das Alter der Action nicht bestimmbar", async () => {
  const befunde = await lauf(AKTION, { kopfGepusht: async () => undefined });
  assert.deepEqual(befunde, [`Update-PR: Alter von actions/checkout ${"2".repeat(40)} nicht bestimmbar.`]);
});

test("ein Fehler bei der Push-Abfrage wirft und merged nicht", async () => {
  await assert.rejects(lauf(AKTION, { kopfGepusht: async () => { throw new Error("GitHub: HTTP 500"); } }), /HTTP 500/);
});

test("ein älterer Push-Zeitpunkt bei altem Stand ergibt keinen Befund", async () => {
  assert.deepEqual(await lauf(AKTION, { kopfGepusht: async () => vorTagen(15) }), []);
  assert.match((await lauf(AKTION, { kopfGepusht: async () => vorTagen(13) }))[0], /14 Tage/);
});

test("ein junger Stand der Action wartet trotz altem Push-Zeitpunkt", async () => {
  const befunde = await lauf(AKTION, { veroeffentlicht: async () => vorTagen(2), kopfGepusht: async () => vorTagen(400) });
  assert.match(befunde[0], /jünger als 14 Tage/);
});

test("npm-Pakete fragen den Push-Zeitpunkt nicht ab", async () => {
  const kopfGepusht = async () => { throw new Error("darf nicht gefragt werden"); };
  assert.deepEqual(await lauf(NPM, { kopfGepusht, veroeffentlicht: async () => vorTagen(400) }), []);
});

test("der Push-Zeitpunkt ist der Zeitstempel des Eintrags mit dem Kopf-SHA im eigenen Repo", async () => {
  const eintraege = [
    { ref: `refs/heads/${BRANCH}`, after: ANDERER, timestamp: "2026-11-01T00:00:00Z" },
    { ref: `refs/heads/${BRANCH}`, after: KOPF, timestamp: "2026-11-06T09:00:00Z" },
  ];
  const { zeit, gefragt } = await kopfGepusht(eintraege);
  assert.equal(zeit, "2026-11-06T09:00:00Z");
  assert.deepEqual(gefragt, ["https://api.github.com/repos/o/r/activity?ref=dependabot%2Fgithub_actions%2Fklein&per_page=100"]);
});

test("ohne Eintrag zum Kopf-SHA gibt es keinen Push-Zeitpunkt", async () => {
  const { zeit } = await kopfGepusht([{ ref: `refs/heads/${BRANCH}`, after: ANDERER, timestamp: "2026-11-01T00:00:00Z" }]);
  assert.equal(zeit, undefined);
});

test("ein HTTP-Fehler der Activity-Abfrage wirft", async () => {
  await assert.rejects(kopfGepusht({ message: "kaputt" }, 500), /HTTP 500/);
});
