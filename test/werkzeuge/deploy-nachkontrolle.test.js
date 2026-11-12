import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { ausgabeAnlegen, zeileBauen } from "../../tools/deploy-weg/ausgabe.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";
import { hoertestIssueAnlegenOderErsetzen } from "../../tools/deploy-weg/hoertest.mjs";
import { revertPushen, updateNachkontrolle } from "../../tools/deploy-weg/zurueckrollen.mjs";
import {
  NACHKONTROLLE_LAUF_TOKEN,
  NACHKONTROLLE_UPDATE_TOKEN,
} from "../gemeinsam/erfundene-geheimnisse.js";

const REPO = "sundartha/hermes";
const COMMIT = "a".repeat(40);
const ANDERER = "b".repeat(40);
const BRANCH = "revert/aaaaaaa";
const TITEL = "Nachkontrolle: Update-Deploy zurückgenommen";
const WEBSITE = "https://github.com/sundartha/hermes/pull/9";
const server = [];
const starte = promisify(execFile);

after(() => {
  for (const eintrag of server) eintrag.close();
});

function zeit() {
  const stand = { t: 0 };
  return { jetzt: () => stand.t, warten: async (ms) => void (stand.t += ms) };
}

function updatePr(aenderung = {}) {
  return {
    merged_at: "2026-11-12T10:00:00Z",
    merge_commit_sha: COMMIT,
    base: { ref: "master" },
    user: { login: "dependabot[bot]" },
    head: { ref: "dependabot/npm_and_yarn/x" },
    labels: [],
    ...aenderung,
  };
}

async function starten(optionen) {
  const anfragen = [];
  const antwort = createServer((anfrage, rueckgabe) => {
    const url = new URL(anfrage.url, "http://127.0.0.1");
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      const koerper = teile.length > 0 ? JSON.parse(Buffer.concat(teile).toString()) : null;
      anfragen.push({
        methode: anfrage.method,
        pfad: url.pathname,
        suche: url.search,
        auth: anfrage.headers.authorization ?? null,
        koerper,
      });
      const [status, daten] = optionen.antwort(anfrage.method, url.pathname, url.searchParams);
      rueckgabe.writeHead(status, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify(daten));
    });
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  return { adresse: `http://127.0.0.1:${antwort.address().port}`, anfragen };
}

function standardAntwort(optionen) {
  const offen = optionen.offenerPr ?? [];
  const routen = new Map([
    ["GET /healthz", () => optionen.healthz ?? [200, { ok: true, commit: COMMIT }]],
    [`GET /repos/${REPO}/commits/${COMMIT}/pulls`, () => [200, optionen.prs ?? [updatePr()]]],
    [
      `GET /repos/${REPO}/pulls`,
      (suche) => [200, suche.get("head") === `sundartha:${BRANCH}` ? offen : []],
    ],
    [`POST /repos/${REPO}/pulls`, () => [201, { number: 9, html_url: WEBSITE }]],
    [`GET /repos/${REPO}/issues`, () => [200, optionen.issues ?? []]],
    [`POST /repos/${REPO}/issues`, () => [201, { number: 77 }]],
    [`PATCH /repos/${REPO}/issues/5`, () => [200, {}]],
  ]);
  return (methode, pfad, suche) => routen.get(`${methode} ${pfad}`)?.(suche) ?? [404, {}];
}

async function laufen(optionen = {}) {
  const { adresse, anfragen } = await starten({ antwort: standardAntwort(optionen) });
  const zeilen = [];
  const revert = [];
  const einstellungen = {
    githubUrl: adresse,
    githubToken: NACHKONTROLLE_LAUF_TOKEN,
    updateToken: Object.hasOwn(optionen, "updateToken")
      ? optionen.updateToken
      : NACHKONTROLLE_UPDATE_TOKEN,
    repository: REPO,
    serverUrl: "https://github.com",
    runId: "42",
    repoDir: ".",
    produktionUrl: adresse,
  };
  const ergebnis = await updateNachkontrolle({
    einstellungen,
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr: zeit(),
    revertBauen: async (angaben) => {
      revert.push(angaben);
      if (optionen.revertFehler) throw new Error("kaputt");
    },
  });
  return { ergebnis, zeilen, anfragen, revert };
}

const schreibend = (anfragen) => anfragen.filter((a) => a.methode !== "GET");
const enthalten = (zeilen, teil) => zeilen.some((zeile) => zeile.includes(teil));

test("Update-Deploy, Produktion fährt den neuen Commit und meldet ok: kein PR, kein Issue", async () => {
  const { ergebnis, zeilen, anfragen, revert } = await laufen();
  assert.equal(ergebnis, true);
  assert.deepEqual(schreibend(anfragen), []);
  assert.deepEqual(revert, []);
  assert.equal(enthalten(zeilen, `Nachkontrolle: Produktion fährt ${COMMIT} und meldet ok`), true);
});

test("falscher Commit bis Fristende: genau ein Revert-PR mit dem Update-Token und ein Issue", async () => {
  const { ergebnis, zeilen, anfragen, revert } = await laufen({
    healthz: [200, { ok: true, commit: ANDERER }],
  });
  assert.equal(ergebnis, true);
  const schreiben = schreibend(anfragen);
  assert.equal(schreiben.length, 2);
  const [pr, issue] = schreiben;
  assert.equal(pr.pfad, `/repos/${REPO}/pulls`);
  assert.equal(pr.auth, `Bearer ${NACHKONTROLLE_UPDATE_TOKEN}`);
  assert.equal(pr.koerper.head, BRANCH);
  assert.equal(pr.koerper.base, "master");
  assert.deepEqual(pr.koerper, {
    title: "Rücknahme des Update-Deploys aaaaaaa",
    head: BRANCH,
    base: "master",
    body: `Die Nachkontrolle nach dem Deploy von ${COMMIT} war rot. Dieser PR nimmt den Commit zurück. Er geht durch die normalen Pflicht-Checks und die normale Freigabe und wird nie automatisch gemergt.`,
  });
  assert.equal(issue.pfad, `/repos/${REPO}/issues`);
  assert.equal(issue.auth, `Bearer ${NACHKONTROLLE_LAUF_TOKEN}`);
  assert.equal(issue.koerper.title, TITEL);
  assert.equal(
    issue.koerper.body,
    [
      `Der Update-Deploy mit Commit ${COMMIT} wurde nachkontrolliert.`,
      "Grund: Nach 30 Minuten: Produktion fährt einen anderen Commit.",
      "",
      `Revert-PR: ${WEBSITE}`,
      "Lauf: https://github.com/sundartha/hermes/actions/runs/42",
      "",
    ].join("\n"),
  );
  assert.equal(enthalten(zeilen, "Nachkontroll-Issue #77 angelegt"), true);
  assert.equal(anfragen.filter((a) => a.pfad === "/healthz").length, 31);
  assert.equal(revert.length, 1);
  assert.equal(revert[0].branch, BRANCH);
  assert.equal(revert[0].commit, COMMIT);
  assert.equal(
    revert[0].remote,
    `https://x-access-token:${NACHKONTROLLE_UPDATE_TOKEN}@github.com/${REPO}.git`,
  );
  assert.equal(enthalten(zeilen, "Revert-PR #9 angelegt"), true);
  assert.equal(enthalten(zeilen, "nach 30 Minuten nicht"), true);
  assert.equal(
    zeilen.some(
      (zeile) =>
        zeile.includes(NACHKONTROLLE_UPDATE_TOKEN) || zeile.includes(NACHKONTROLLE_LAUF_TOKEN),
    ),
    false,
  );
});

test("healthz nicht ok bis Fristende nennt das als Grund", async () => {
  const { anfragen } = await laufen({ healthz: [503, { ok: false, commit: COMMIT }] });
  const issue = schreibend(anfragen).find((a) => a.pfad.endsWith("/issues"));
  assert.match(issue.koerper.body, /Nach 30 Minuten: \/healthz antwortet nicht mit ok\./);
});

test("zweiter Lauf zum selben Commit: kein zweiter PR, das Issue wird ersetzt", async () => {
  const { ergebnis, anfragen, revert, zeilen } = await laufen({
    healthz: [200, { ok: true, commit: ANDERER }],
    offenerPr: [{ number: 9, html_url: WEBSITE, head: { ref: BRANCH } }],
    issues: [{ number: 5, title: TITEL, user: { login: "github-actions[bot]" } }],
  });
  assert.equal(ergebnis, true);
  assert.deepEqual(revert, []);
  const schreiben = schreibend(anfragen);
  assert.deepEqual(
    schreiben.map((a) => `${a.methode} ${a.pfad}`),
    [`PATCH /repos/${REPO}/issues/5`],
  );
  const { body } = schreiben[0].koerper;
  assert.ok(body.includes(`Revert-PR: ${WEBSITE}`));
  assert.equal(enthalten(zeilen, "Revert-PR #9 existiert schon"), true);
  assert.equal(enthalten(zeilen, "Nachkontroll-Issue #5: Text ersetzt"), true);
});

const KEIN_UPDATE = [
  [
    "Autor, Branch und Label sind keine Update-Merkmale",
    updatePr({ user: { login: "mensch" }, head: { ref: "paket/x" } }),
  ],
  ["Update-PR ohne Merge", updatePr({ merged_at: null })],
  ["Update-PR mit anderem Merge-Commit", updatePr({ merge_commit_sha: ANDERER })],
  ["Update-PR gegen anderen Zweig", updatePr({ base: { ref: "andere" } })],
  [
    "PR ohne Labels",
    updatePr({ user: { login: "mensch" }, head: { ref: "paket/x" }, labels: undefined }),
  ],
];

for (const [name, pr] of KEIN_UPDATE) {
  test(`kein Update-Deploy (${name}): nichts passiert, /healthz wird nicht gefragt`, async () => {
    const { ergebnis, zeilen, anfragen } = await laufen({
      prs: [pr],
      healthz: [200, { ok: true, commit: ANDERER }],
    });
    assert.equal(ergebnis, true);
    assert.deepEqual(schreibend(anfragen), []);
    assert.equal(
      anfragen.some((a) => a.pfad === "/healthz"),
      false,
    );
    assert.equal(enthalten(zeilen, "Kein Update-Deploy"), true);
  });
}

const UPDATE_ARTEN = [
  ["Dependabot-Autor", updatePr({ head: { ref: "paket/x" } })],
  ["Dependabot-Zweig", updatePr({ user: { login: "mensch" } })],
  [
    "Node-Label",
    updatePr({
      user: { login: "mensch" },
      head: { ref: "paket/x" },
      labels: [{ name: "node-hauptversion" }],
    }),
  ],
];

for (const [name, pr] of UPDATE_ARTEN) {
  test(`Update-Deploy erkannt über ${name}`, async () => {
    const { anfragen } = await laufen({ prs: [pr], healthz: [200, { ok: true, commit: ANDERER }] });
    assert.equal(schreibend(anfragen).length, 2);
  });
}

test("ein offener PR mit anderem Branch gilt nicht als Revert-PR", async () => {
  const { anfragen } = await laufen({
    healthz: [200, { ok: true, commit: ANDERER }],
    offenerPr: [{ number: 3, html_url: WEBSITE, head: { ref: "revert/bbbbbbb" } }],
  });
  assert.equal(schreibend(anfragen)[0].pfad, `/repos/${REPO}/pulls`);
});

test("ein offenes Hörtest-Issue wird von der Nachkontrolle nicht überschrieben", async () => {
  const { anfragen } = await laufen({
    healthz: [200, { ok: true, commit: ANDERER }],
    issues: [
      {
        number: 5,
        title: "Hörtest nötig vor dem Live-Deploy",
        user: { login: "github-actions[bot]" },
      },
    ],
  });
  const issue = schreibend(anfragen)[1];
  assert.equal(`${issue.methode} ${issue.pfad}`, `POST /repos/${REPO}/issues`);
});

test("Hörtest-Issue: angelegt und ersetzt behalten ihre Meldungen", async () => {
  for (const [issues, erwartet] of [
    [[], "Hörtest-Issue #77 angelegt"],
    [
      [
        {
          number: 5,
          title: "Hörtest nötig vor dem Live-Deploy",
          user: { login: "github-actions[bot]" },
        },
      ],
      "Hörtest-Issue #5: Text ersetzt",
    ],
  ]) {
    const { adresse } = await starten({ antwort: standardAntwort({ issues }) });
    const zeilen = [];
    await hoertestIssueAnlegenOderErsetzen({
      einstellungen: {
        githubUrl: adresse,
        githubToken: "t",
        repository: REPO,
        serverUrl: "https://github.com",
        runId: "1",
      },
      commit: COMMIT,
      teile: [],
      ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    });
    assert.deepEqual(zeilen, [erwartet]);
  }
});

test("Token fehlt: rot, kein PR, Issue mit Hinweis auf den Handweg", async () => {
  const { ergebnis, zeilen, anfragen, revert } = await laufen({
    healthz: [200, { ok: true, commit: ANDERER }],
    updateToken: null,
  });
  assert.equal(ergebnis, false);
  assert.deepEqual(revert, []);
  const schreiben = schreibend(anfragen);
  assert.equal(schreiben.length, 1);
  assert.equal(schreiben[0].pfad, `/repos/${REPO}/issues`);
  assert.match(schreiben[0].koerper.body, /Rücknahme von Hand über notfall\/zurueckrollen/);
  assert.equal(enthalten(zeilen, "UPDATE_WORKFLOW_TOKEN fehlt"), true);
});

test("Revert-Branch lässt sich nicht bauen: rot, kein PR, Issue nennt den Handweg", async () => {
  const { ergebnis, zeilen, anfragen } = await laufen({
    healthz: [200, { ok: true, commit: ANDERER }],
    revertFehler: true,
  });
  assert.equal(ergebnis, false);
  const schreiben = schreibend(anfragen);
  assert.deepEqual(
    schreiben.map((a) => a.pfad),
    [`/repos/${REPO}/issues`],
  );
  assert.match(schreiben[0].koerper.body, /Kein Revert-PR/);
  assert.equal(enthalten(zeilen, "Revert-Branch ließ sich nicht bauen"), true);
});

function git(ordner, ...argumente) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.org",
      "-c",
      "commit.gpgsign=false",
      ...argumente,
    ],
    { cwd: ordner, encoding: "utf8" },
  ).trim();
}

function repoAnlegen() {
  const wurzel = mkdtempSync(join(tmpdir(), "nachkontrolle-"));
  const fern = join(wurzel, "fern.git");
  const arbeit = join(wurzel, "arbeit");
  mkdirSync(arbeit);
  git(wurzel, "init", "-q", "--bare", "-b", "master", fern);
  git(arbeit, "init", "-q", "-b", "master");
  writeFileSync(join(arbeit, "datei.txt"), "alt\n");
  git(arbeit, "add", "datei.txt");
  git(arbeit, "commit", "-q", "-m", "start");
  return { fern, arbeit };
}

test("revertPushen nimmt einen Merge-Commit zurück und pusht den Branch", async () => {
  const { fern, arbeit } = repoAnlegen();
  git(arbeit, "switch", "-q", "-c", "update");
  writeFileSync(join(arbeit, "datei.txt"), "neu\n");
  git(arbeit, "commit", "-q", "-am", "update");
  git(arbeit, "switch", "-q", "master");
  writeFileSync(join(arbeit, "andere.txt"), "x\n");
  git(arbeit, "add", "andere.txt");
  git(arbeit, "commit", "-q", "-m", "dazwischen");
  git(arbeit, "merge", "-q", "--no-ff", "-m", "merge", "update");
  const merge = git(arbeit, "rev-parse", "HEAD");
  await revertPushen({ commit: merge, branch: BRANCH, repoDir: arbeit, remote: fern });
  const geholt = git(arbeit, "--git-dir", fern, "show", `${BRANCH}:datei.txt`);
  assert.equal(geholt, "alt");
  assert.equal(git(arbeit, "--git-dir", fern, "show", `${BRANCH}:andere.txt`), "x");
  assert.match(
    git(arbeit, "--git-dir", fern, "log", "-1", "--format=%s", BRANCH),
    /^Revert "merge"/,
  );
});

test("revertPushen nimmt auch einen Squash-Commit ohne Hauptlinie zurück", async () => {
  const { fern, arbeit } = repoAnlegen();
  writeFileSync(join(arbeit, "datei.txt"), "neu\n");
  git(arbeit, "commit", "-q", "-am", "squash");
  const commit = git(arbeit, "rev-parse", "HEAD");
  await revertPushen({ commit, branch: BRANCH, repoDir: arbeit, remote: fern });
  assert.equal(git(arbeit, "--git-dir", fern, "show", `${BRANCH}:datei.txt`), "alt");
  assert.equal(readFileSync(join(arbeit, "datei.txt"), "utf8"), "alt\n");
  assert.equal(
    git(arbeit, "--git-dir", fern, "log", "-1", "--format=%an <%ae>", BRANCH),
    "github-actions[bot] <github-actions[bot]@users.noreply.github.com>",
  );
});

test("revertPushen scheitert, wenn der Push nicht gelingt", async () => {
  const { arbeit } = repoAnlegen();
  writeFileSync(join(arbeit, "datei.txt"), "neu\n");
  git(arbeit, "commit", "-q", "-am", "zwei");
  const zwei = git(arbeit, "rev-parse", "HEAD");
  await assert.rejects(
    revertPushen({
      commit: zwei,
      branch: BRANCH,
      repoDir: arbeit,
      remote: join(arbeit, "gibt-es-nicht.git"),
    }),
  );
});

test("revertPushen bricht in einem flachen Checkout ab und pusht nichts", async () => {
  const { fern, arbeit } = repoAnlegen();
  git(arbeit, "switch", "-q", "-c", "update");
  writeFileSync(join(arbeit, "datei.txt"), "neu\n");
  git(arbeit, "commit", "-q", "-am", "update");
  git(arbeit, "switch", "-q", "master");
  writeFileSync(join(arbeit, "andere.txt"), "x\n");
  git(arbeit, "add", "andere.txt");
  git(arbeit, "commit", "-q", "-m", "dazwischen");
  git(arbeit, "merge", "-q", "--no-ff", "-m", "merge", "update");
  const merge = git(arbeit, "rev-parse", "HEAD");
  const flach = join(tmpdir(), "flach-" + merge.slice(0, 8) + "-" + process.pid);
  git(tmpdir(), "clone", "-q", "--depth", "1", "file://" + arbeit, flach);
  await assert.rejects(
    revertPushen({ commit: merge, branch: BRANCH, repoDir: flach, remote: fern }),
  );
  assert.equal(git(arbeit, "--git-dir", fern, "branch", "--list", BRANCH), "");
});

const BASIS_UMGEBUNG = {
  GITHUB_TOKEN: NACHKONTROLLE_LAUF_TOKEN,
  GITHUB_REPOSITORY: REPO,
  GITHUB_RUN_ID: "42",
  PRODUKTION_URL: "https://app.example.org",
};

test("Einstellungen der Nachkontrolle: Update-Token ist freiwillig, geheim und geprüft", () => {
  const zeilen = [];
  const ausgabe = ausgabeAnlegen((zeile) => zeilen.push(zeile));
  const ohne = einstellungenLesen("nachkontrolle", BASIS_UMGEBUNG, ausgabe);
  assert.equal(ohne.updateToken, null);
  const mit = einstellungenLesen(
    "nachkontrolle",
    { ...BASIS_UMGEBUNG, UPDATE_WORKFLOW_TOKEN: NACHKONTROLLE_UPDATE_TOKEN },
    ausgabe,
  );
  assert.equal(mit.updateToken, NACHKONTROLLE_UPDATE_TOKEN);
  assert.equal(zeilen.includes(`::add-mask::${NACHKONTROLLE_UPDATE_TOKEN}`), true);
  assert.throws(() =>
    einstellungenLesen(
      "nachkontrolle",
      { ...BASIS_UMGEBUNG, UPDATE_WORKFLOW_TOKEN: "mit leer" },
      ausgabe,
    ),
  );
  assert.equal(zeilen.at(-1), "Einstellung fehlt oder ist ungültig: UPDATE_WORKFLOW_TOKEN");
});

test("Meldungstexte der Nachkontrolle", () => {
  assert.match(zeileBauen("aufruf"), /nachkontrolle --commit <sha>/);
  assert.equal(
    zeileBauen("abbruch_http", { schritt: "revert_pr", http: 422 }),
    "Abbruch im Schritt revert_pr: HTTP 422",
  );
});

test("Befehl nachkontrolle über die Kommandozeile: kein Update-Deploy endet grün", async () => {
  const { adresse } = await starten({
    antwort: standardAntwort({ prs: [updatePr({ merged_at: null })] }),
  });
  const { stdout } = await starte(
    "node",
    ["tools/deploy-weg.mjs", "nachkontrolle", "--commit", COMMIT],
    {
      env: {
        ...BASIS_UMGEBUNG,
        PATH: process.env.PATH,
        GITHUB_API_URL: adresse,
        PRODUKTION_URL: adresse,
      },
    },
  );
  assert.match(stdout, /Kein Update-Deploy: keine Nachkontrolle nötig\n/);
  assert.match(stdout, /Ergebnis: ja\n$/);
});
