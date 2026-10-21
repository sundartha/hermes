import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const WERKZEUG = join(REPO_ROOT, "tools/freigabe-pruefung.mjs");
const PR = 7;
const ISSUE = 41;
const ZWEITES_ISSUE = 42;
const FREMDE_PR = 43;
const PULL_REQUEST_NUMMERN = new Set([PR, FREMDE_PR]);
const AUTOR = "sundartha-agent";
const ANTONIO = "Antonio20045";
const OHNE_NETZ = "http://127.0.0.1:9";
const EXIT_OK = 0;
const EXIT_ROT = 1;
const EINRUECKUNG = 2;
const EINTRAG = "wartung.yml";
const SHA_LAENGE = 40;
const FREMDER_STAND = "0".repeat(SHA_LAENGE);
const VERKNUEPFT = `Closes #${ISSUE}`;
const ANKUENDIGUNG_MARKER = "<!-- freigabe-ankuendigung -->";
const ZUSAMMENFASSUNG_MARKER = "<!-- freigabe-zusammenfassung -->";
const WORKFLOW_BOT = "github-actions[bot]";
const VOR_DEM_APPROVE = "2026-10-20T11:00:00Z";
const APPROVE_ZEIT = "2026-10-20T12:00:00Z";
const NACH_DEM_APPROVE = "2026-10-20T13:00:00Z";
const BLOCKIERT = /Muss geändert werden: Die Prüfung „Fundliste“ wird lockerer/;
const ANGEKUENDIGT = `Ausnahme nach Issue #${ISSUE} (geschrieben von ${AUTOR}): Die Prüfung „Fundliste“ wird lockerer ohne Fehlalarm-Beispiel für ${EINTRAG}; ein Approve`;
const FREIGEGEBEN = new RegExp(
  `Freigegebene Ausnahme laut Issue #${ISSUE} \\(geschrieben von ${AUTOR}[^)]*\\): Die Prüfung „Fundliste“ wird lockerer`,
);
const ZWEITE_PRUEFUNG = {
  "test/werkzeuge/rotproben/zweite/pruefung.json": JSON.stringify({
    titel: "Zweite Liste",
    pfade: ["tools/zweite.mjs"],
  }),
};

function freigabe(eintrag) {
  return `## Freigabe Antonio 2026-10-20\n\nDie Prüfung „Fundliste“ darf den Eintrag \`${eintrag}\` aufnehmen.`;
}

const FREIGABE_FUER_FUNDLISTE = freigabe(EINTRAG);

function json(wert) {
  return `${JSON.stringify(wert, null, EINRUECKUNG)}\n`;
}

const FUNDLISTE = [
  'import { readFileSync } from "node:fs";',
  'const liste = JSON.parse(readFileSync("tools/basis/funde.json", "utf8"));',
  'const funde = readFileSync("funde.txt", "utf8").split("\\n").filter(Boolean);',
  "for (const fund of funde.filter((name) => !liste.includes(name))) {",
  '  console.error("nicht erlaubt: " + fund);',
  "  process.exitCode = 1;",
  "}",
  "",
].join("\n");

const FUNDLISTE_MANIFEST = "test/werkzeuge/rotproben/funde/pruefung.json";
const FREMDER_FUND = "test/werkzeuge/rotproben/funde/fremd.json";

const BASIS = {
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n/test/werkzeuge/ @Antonio20045\n",
  "tools/funde.mjs": FUNDLISTE,
  "tools/basis/funde.json": json(["alt.yml"]),
  "funde.txt": "alt.yml\n",
  [FUNDLISTE_MANIFEST]: json({
    titel: "Fundliste",
    pfade: ["tools/funde.mjs", "tools/basis/funde.json"],
    treffer: { befehl: ["node", "{wurzel}/tools/funde.mjs"], zaehlen: "stderr-zeilen" },
    ausnahmen: {
      bezeichnung: "Erlaubte Funde",
      datei: "tools/basis/funde.json",
      zaehlen: "anzahl",
    },
    probe: {
      mitnehmen: ["tools/basis/funde.json"],
      befehl: ["node", "{wurzel}/tools/funde.mjs"],
    },
  }),
  [FREMDER_FUND]: json({
    titel: "Fremder Fund",
    dateien: { "funde.txt": ["fremd.yml"] },
    erwartet: "nicht erlaubt",
  }),
};

function neuerEintrag(eintrag) {
  return {
    "funde.txt": `alt.yml\n${eintrag}\n`,
    "tools/basis/funde.json": json(["alt.yml", eintrag]),
  };
}

function stand(context, { nachricht, aenderung, startdateien = BASIS }) {
  const ordner = probeRepository(context, startdateien);
  const basis = runIn(ordner, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(ordner, aenderung);
  commitAll(ordner, nachricht);
  return { ordner, basis, kopf: runIn(ordner, "git", ["rev-parse", "HEAD"]).stdout.trim() };
}

function graphqlAntwort({ query, variables: { number } }, { issue, pullRequest, fehler }) {
  if (fehler !== undefined) return { errors: [{ message: fehler }] };
  if (/\bpullRequest\(/.test(query)) return { data: { repository: { pullRequest } } };
  const istPullRequest = PULL_REQUEST_NUMMERN.has(number);
  if (/\bissueOrPullRequest\(/.test(query)) {
    const knoten = istPullRequest
      ? { ...issue, number, __typename: "PullRequest" }
      : { ...issue, __typename: "Issue" };
    return { data: { repository: { issueOrPullRequest: knoten } } };
  }
  if (istPullRequest) {
    const message = `Could not resolve to an Issue with the number of ${number}.`;
    return { data: { repository: { issue: null } }, errors: [{ message }] };
  }
  return { data: { repository: { issue } } };
}

function graphqlRoute(verbindung, fall, daten) {
  if (fall.ohneGraphql) return [];
  const antwort = {
    toJSON: () =>
      graphqlAntwort(verbindung.anfragen.at(-1).rumpf, { ...daten, fehler: fall.graphqlFehler }),
  };
  return [["POST /graphql", antwort]];
}

function approve(commit, login = ANTONIO) {
  return {
    user: { login },
    state: "APPROVED",
    commit_id: commit,
    submitted_at: APPROVE_ZEIT,
  };
}

async function scheinGithubFuer(context, fall, kopf) {
  const issue = {
    number: ISSUE,
    body: fall.issueText,
    createdAt: fall.angelegt ?? VOR_DEM_APPROVE,
    lastEditedAt: fall.bearbeitet ?? null,
    author: { login: AUTOR },
    editor: fall.bearbeiter === undefined ? null : { login: fall.bearbeiter },
  };
  const pullRequest = { createdAt: VOR_DEM_APPROVE, lastEditedAt: fall.prBearbeitet ?? null };
  const pull = { number: PR, head: { sha: kopf }, labels: [], body: fall.prText ?? VERKNUEPFT };
  const verbindung = {};
  const github = await scheinGithub(
    context,
    new Map([
      [`GET ${API_PFAD}/pulls/${PR}`, pull],
      [
        `GET ${API_PFAD}/pulls/${PR}/reviews`,
        fall.reviews?.(kopf) ?? [approve(fall.approveAuf ?? kopf)],
      ],
      [`GET ${API_PFAD}/issues/${PR}/comments`, fall.kommentare ?? []],
      [`POST ${API_PFAD}/issues/${PR}/comments`, {}],
      [`POST ${API_PFAD}/issues/${PR}/labels`, {}],
      ...graphqlRoute(verbindung, fall, { issue, pullRequest }),
    ]),
  );
  return Object.assign(verbindung, github);
}

function starte(ordner, github, aufruf) {
  return starteWerkzeug([WERKZEUG, ...aufruf, "--registry", OHNE_NETZ, "--downloads", OHNE_NETZ], {
    cwd: ordner,
    umgebung: {
      GITHUB_API_URL: github.url,
      GITHUB_GRAPHQL_URL: `${github.url}/graphql`,
      GITHUB_TOKEN: "probe",
      GITHUB_REPOSITORY: REPO,
    },
  });
}

function gepostet(github, marker) {
  const texte = github.anfragen
    .filter(({ methode, pfad }) => methode === "POST" && pfad.endsWith("/comments"))
    .map(({ rumpf }) => rumpf.body);
  return texte.find((body) => body.startsWith(marker)) ?? "";
}

async function ankuendigungHolen(context, fall, { ordner, kopf, aufruf }) {
  if (fall.ankuendigung === null) return [];
  const github = await scheinGithubFuer(context, { ...fall, reviews: () => [] }, kopf);
  await starte(ordner, github, aufruf);
  const body = gepostet(github, ANKUENDIGUNG_MARKER);
  if (body === "") return [];
  const kommentar = {
    id: 2,
    user: { login: WORKFLOW_BOT },
    body,
    created_at: VOR_DEM_APPROVE,
    updated_at: VOR_DEM_APPROVE,
  };
  return [fall.ankuendigung?.(kommentar, kopf) ?? kommentar];
}

async function pruefe(context, fall) {
  const repo = stand(context, {
    nachricht: fall.commitNachricht ?? "Neuer Eintrag",
    aenderung: fall.aenderung ?? neuerEintrag(EINTRAG),
    startdateien: fall.startdateien,
  });
  const aufruf = ["--basis", repo.basis, "--pr", String(PR)];
  const angekuendigt = await ankuendigungHolen(context, fall, { ...repo, aufruf });
  const kommentare = [...(fall.kommentare ?? []), ...angekuendigt];
  const github = await scheinGithubFuer(context, { ...fall, kommentare }, repo.kopf);
  const lauf = await starte(repo.ordner, github, aufruf);
  const issueAbfragen = github.anfragen
    .filter(
      ({ pfad, rumpf }) => pfad === "/graphql" && /\bissue(OrPullRequest)?\(/.test(rumpf.query),
    )
    .map(({ rumpf }) => rumpf.variables.number);
  return {
    ...lauf,
    zusammenfassung: gepostet(github, ZUSAMMENFASSUNG_MARKER),
    ankuendigung: gepostet(github, ANKUENDIGUNG_MARKER),
    issueAbfragen,
  };
}

function blockiert(lauf) {
  return lauf.status === EXIT_ROT && BLOCKIERT.test(lauf.stdout);
}

function blockiertOhneFreigabe(lauf) {
  return blockiert(lauf) && !lauf.stdout.includes("Freigegebene Ausnahme");
}

async function pruefeInDerWarteschlange(context, inDerWarteschlange) {
  const repo = wegwerfRepo(context, BASIS);
  const vorher = repo.git(["rev-parse", "HEAD"]);
  repo.git(["checkout", "-q", "-b", "eintrag"]);
  const kopf = repo.committe(neuerEintrag(EINTRAG), "Neuer Eintrag");
  const fall = { issueText: FREIGABE_FUER_FUNDLISTE };
  const kommentare = await ankuendigungHolen(context, fall, {
    ordner: repo.ordner,
    kopf,
    aufruf: ["--basis", vorher, "--pr", String(PR)],
  });
  repo.git(["push", "-q", "origin", `HEAD:refs/pull/${PR}/head`]);
  repo.git(["checkout", "-q", "master"]);
  const basis = repo.committe({ "src/anders.js": "export const ANDERS = 1;\n" }, "Anderer PR");
  repo.committe(inDerWarteschlange, "Neuer Eintrag");
  const ref = `gh-readonly-queue/master/pr-${PR}-${repo.git(["rev-parse", "HEAD"])}`;
  const github = await scheinGithubFuer(context, { ...fall, kommentare }, kopf);
  return starte(repo.ordner, github, ["--basis", basis, "--warteschlange", ref]);
}

test("(a) eine gelockerte Ausnahmeliste ohne Fehlalarm-Beispiel und ohne Freigabe-Abschnitt im Issue bleibt mit Approve rot", async (context) => {
  const lauf = await pruefe(context, { issueText: "## Absicht\n\nNeuer Workflow." });
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("(b) ein Freigabe-Abschnitt im Issue ohne Approve auf dem aktuellen Stand bleibt rot, die Zusammenfassung kündigt die Ausnahme an", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    approveAuf: FREMDER_STAND,
  });
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
  assert.ok(lauf.zusammenfassung.includes(ANGEKUENDIGT), lauf.zusammenfassung);
});

test("(c) ein Freigabe-Abschnitt, der eine andere Prüfung nennt, hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: `## Freigabe Antonio 2026-10-20\n\nDie Prüfung „Kopien (jscpd)“ darf \`${EINTRAG}\` aufnehmen.`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("(d) ein Freigabe-Abschnitt nur im PR-Text, im Kommentar oder in der Commit-Nachricht zählt nicht", async (context) => {
  const lauf = await pruefe(context, {
    issueText: "## Absicht\n\nNeuer Workflow.",
    prText: `${VERKNUEPFT}\n\n${FREIGABE_FUER_FUNDLISTE}`,
    kommentare: [{ id: 1, body: FREIGABE_FUER_FUNDLISTE }],
    commitNachricht: `Neuer Eintrag\n\n${FREIGABE_FUER_FUNDLISTE}`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("(e) Freigabe-Abschnitt im verknüpften Issue und Approve auf dem Kopf: nicht mehr blockiert, die Zusammenfassung nennt die Ausnahme", async (context) => {
  const lauf = await pruefe(context, {
    issueText: `## Absicht\n\nNeuer Workflow.\n\n${FREIGABE_FUER_FUNDLISTE}\n\n## Bereich\n\n- tools/basis/funde.json`,
    bearbeitet: VOR_DEM_APPROVE,
    bearbeiter: ANTONIO,
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.equal(lauf.ankuendigung, "", "zu diesem Stand liegt die Ankündigung schon vor");
  assert.doesNotMatch(lauf.stdout, /Muss geändert werden/);
  assert.match(lauf.stdout, FREIGEGEBEN);
  assert.match(lauf.zusammenfassung, FREIGEGEBEN);
  assert.ok(
    lauf.zusammenfassung.includes(
      `Issue #${ISSUE} (geschrieben von ${AUTOR}, zuletzt bearbeitet von ${ANTONIO})`,
    ),
    lauf.zusammenfassung,
  );
  assert.match(lauf.zusammenfassung, /\*\*Fundliste: lockerer\*\*/);
});

test("ein Issue, dessen Text nach dem Approve geändert wurde, hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    bearbeitet: NACH_DEM_APPROVE,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("ein Freigabe-Abschnitt, der die Prüfung nennt, aber nicht den neuen Eintrag, hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText:
      "## Freigabe Antonio 2026-10-20\n\nDie Prüfung „Fundliste“ darf einen Workflow aufnehmen.",
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("ein Abschnitt mit anderer Überschrift als „## Freigabe Antonio <Datum>“ zählt nicht", async (context) => {
  const lauf = await pruefe(context, {
    issueText: `### Freigabe Antonio\n\nDie Prüfung „Fundliste“ darf den Eintrag \`${EINTRAG}\` aufnehmen.`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("ändert der PR neben der Ausnahmeliste auch die Prüfung selbst, hebt der Freigabe-Abschnitt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    aenderung: {
      ...neuerEintrag(EINTRAG),
      "tools/funde.mjs": `${FUNDLISTE}export const GEPRUEFT = true;\n`,
    },
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("lässt der neue Eintrag eine Rot-Probe durch, hebt der Freigabe-Abschnitt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: freigabe("fremd.yml"),
    aenderung: neuerEintrag("fremd.yml"),
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.match(
    lauf.zusammenfassung,
    /„Fremder Fund“: auf master gestoppt, mit diesem PR durchgelassen/,
  );
});

test("ein Issue, das erst nach dem Approve angelegt und nie bearbeitet wurde, hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    angelegt: NACH_DEM_APPROVE,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("ein Abschnitt, der den Eintrag nur als Teil eines längeren Namens nennt, hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, { issueText: freigabe(`neue-${EINTRAG}`) });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("in der Warteschlange gilt die freigegebene Ausnahme bei gleicher Änderung wie im PR", async (context) => {
  const lauf = await pruefeInDerWarteschlange(context, neuerEintrag(EINTRAG));
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
  assert.doesNotMatch(lauf.stdout, /Muss geändert werden/);
});

test("weicht die Änderung in der Warteschlange vom PR ab, gilt die freigegebene Ausnahme nicht", async (context) => {
  const lauf = await pruefeInDerWarteschlange(context, {
    ...neuerEintrag(EINTRAG),
    "tools/basis/funde.json": `${JSON.stringify(["alt.yml", EINTRAG])}\n`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /zählt in der Warteschlange nicht/);
});

test("ein Freigabe-Abschnitt in einem HTML-Kommentar des Issues zählt nicht", async (context) => {
  const lauf = await pruefe(context, {
    issueText: `## Absicht\n\nNeuer Workflow.\n\n<!--\n${FREIGABE_FUER_FUNDLISTE}\n-->`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, /Ausnahme nach Issue/);
});

test("ein Approve von jemand anderem als Antonio20045 oder jonas986 hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    reviews: (kopf) => [approve(kopf, "fremder-nutzer")],
  });
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("ein verworfenes Approve von Antonio hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    reviews: (kopf) => [approve(kopf), { ...approve(kopf), state: "DISMISSED" }],
  });
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("ein nach dem Approve geänderter PR-Text, der ein Issue mit Freigabe-Abschnitt verknüpft, hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    prBearbeitet: NACH_DEM_APPROVE,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.ok(lauf.zusammenfassung.includes(ANGEKUENDIGT), lauf.zusammenfassung);
});

test("bei zwei Closes im PR-Text liest die Prüfung beide Issues und nennt das freigebende", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    prText: `Closes #${ZWEITES_ISSUE}\n${VERKNUEPFT}`,
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.deepEqual(new Set(lauf.issueAbfragen), new Set([ISSUE, ZWEITES_ISSUE]));
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("steht der neue Eintrag in einer Zeile für eine andere Prüfung, hebt der Abschnitt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    issueText: `## Freigabe Antonio 2026-10-20\n\n- Die Prüfung „Kopien (jscpd)“ darf \`${EINTRAG}\` aufnehmen.\n- Die Prüfung „Fundliste“ bleibt unverändert.`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("eine Zeile, die zwei Prüfungen für den Eintrag nennt, hebt die Sperre nicht auf", async (context) => {
  const lauf = await pruefe(context, {
    startdateien: { ...BASIS, ...ZWEITE_PRUEFUNG },
    issueText: `## Freigabe Antonio 2026-10-20\n\n- Die Prüfungen „Fundliste“ und „Zweite Liste“ dürfen \`${EINTRAG}\` aufnehmen.`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("eine Freigabe-Überschrift in einem Codeblock oder mit vier Leerzeichen Einzug zählt nicht", async (context) => {
  const lauf = await pruefe(context, {
    issueText: `## Vorlage\n\n\`\`\`\n${FREIGABE_FUER_FUNDLISTE}\n\`\`\`\n\n    ${FREIGABE_FUER_FUNDLISTE}`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, /Ausnahme nach Issue/);
});

test("eine Freigabe-Überschrift mit ungültigem Datum zählt nicht", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE.replace("2026-10-20", "2026-02-30"),
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
});

test("läuft eine Rot-Probe der Prüfung nicht, hebt der Freigabe-Abschnitt die Sperre nicht auf", async (context) => {
  const manifest = JSON.parse(BASIS[FUNDLISTE_MANIFEST]);
  const lauf = await pruefe(context, {
    startdateien: {
      ...BASIS,
      [FUNDLISTE_MANIFEST]: json({ ...manifest, benoetigt: "fehlendes-werkzeug-faf" }),
    },
    issueText: FREIGABE_FUER_FUNDLISTE,
  });
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("hat die Prüfung keine Rot-Probe, hebt der Freigabe-Abschnitt die Sperre nicht auf", async (context) => {
  const ohneProbe = Object.fromEntries(
    Object.entries(BASIS).filter(([pfad]) => pfad !== FREMDER_FUND),
  );
  const lauf = await pruefe(context, {
    startdateien: ohneProbe,
    issueText: FREIGABE_FUER_FUNDLISTE,
  });
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

function mitAnkuendigung(context, ankuendigung) {
  return pruefe(context, { issueText: FREIGABE_FUER_FUNDLISTE, ankuendigung });
}

test("ohne Ankündigung im PR hebt das Approve die Sperre nicht auf, die Prüfung kündigt die Ausnahme jetzt an", async (context) => {
  const lauf = await mitAnkuendigung(context, null);
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /vor dem Approve nicht angekündigt/);
  assert.ok(lauf.ankuendigung.includes(`\`${EINTRAG}\``), lauf.ankuendigung);
});

test("eine Ankündigung, die erst nach dem Approve geschrieben wurde, hebt die Sperre nicht auf", async (context) => {
  const lauf = await mitAnkuendigung(context, (kommentar) => ({
    ...kommentar,
    created_at: NACH_DEM_APPROVE,
    updated_at: NACH_DEM_APPROVE,
  }));
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("eine Ankündigung, die nach dem Approve bearbeitet wurde, hebt die Sperre nicht auf", async (context) => {
  const lauf = await mitAnkuendigung(context, (kommentar) => ({
    ...kommentar,
    updated_at: NACH_DEM_APPROVE,
  }));
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("eine Ankündigung zu einem anderen Stand hebt die Sperre nicht auf", async (context) => {
  const lauf = await mitAnkuendigung(context, (kommentar, kopf) => ({
    ...kommentar,
    body: kommentar.body.split(kopf).join(FREMDER_STAND),
  }));
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("eine Ankündigung, die nicht der Workflow geschrieben hat, hebt die Sperre nicht auf", async (context) => {
  const lauf = await mitAnkuendigung(context, (kommentar) => ({
    ...kommentar,
    user: { login: AUTOR },
  }));
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

test("eine Ankündigung, die einen anderen Eintrag nennt, hebt die Sperre nicht auf", async (context) => {
  const lauf = await mitAnkuendigung(context, (kommentar) => ({
    ...kommentar,
    body: kommentar.body.split(EINTRAG).join(`anders-${EINTRAG}`),
  }));
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
});

const FREIGABE_ZEILEN = FREIGABE_FUER_FUNDLISTE.split("\n");
const FREIGABE_UEBERSCHRIFT = FREIGABE_ZEILEN[0];
const FREIGABEZEILE = FREIGABE_ZEILEN.at(-1);
const BELIEBIGER_TEXT = "Beliebiger Text, der keine Prüfung und keinen Eintrag nennt.";
const NICHT_ANGEKUENDIGT = /Ausnahme nach Issue/;
const GESCHUETZTES_LEERZEICHEN = "\u00A0";
const ZAUN_MIT_LEERZEICHEN = "```" + GESCHUETZTES_LEERZEICHEN;
const ABBRUCH = "Freigabe-Prüfung: Abbruch:";
const FREIGABE_AUSNAHME = /Freigegebene Ausnahme/;

function pruefeAbschnitt(context, ...zeilen) {
  return pruefe(context, { issueText: [FREIGABE_UEBERSCHRIFT, "", ...zeilen].join("\n") });
}

function pruefeAbbruch(context, abweichung) {
  return pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    ankuendigung: null,
    ...abweichung,
  });
}

test("eine Freigabezeile in einem Codeblock unter der Freigabe-Überschrift zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Tilde-Codeblock unter der Freigabe-Überschrift zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "~~~", FREIGABEZEILE, "~~~");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Codeblock hinter einem Listenpunkt zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Tilde-Codeblock hinter einem nummerierten Listenpunkt zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "1. ~~~", FREIGABEZEILE, "~~~");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein nicht geschlossener Codeblock macht den Rest des Abschnitts zum Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile außerhalb des Codeblocks gilt weiter, auch wenn der Abschnitt einen Codeblock mit beliebigem Text hat", async (context) => {
  const lauf = await pruefeAbschnitt(context, FREIGABEZEILE, "", "```", BELIEBIGER_TEXT, "```");
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Freigabezeile nach einem Codeblock hinter einem Listenpunkt gilt weiter", async (context) => {
  const eingerueckt = `  ${BELIEBIGER_TEXT}`;
  const lauf = await pruefeAbschnitt(
    context,
    "- ```",
    eingerueckt,
    "",
    eingerueckt,
    "  ```",
    "",
    FREIGABEZEILE,
  );
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Zaunzeile ohne Einzug beendet den Zaun hinter einem Listenpunkt und öffnet einen neuen Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", "```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("nach Text ohne Einzug im Zaun hinter einem Listenpunkt öffnet die nächste Zaunzeile ohne Einzug einen neuen Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", BELIEBIGER_TEXT, "```", "", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Zaunzeile mit nur einem Leerzeichen Einzug beendet den Zaun hinter einem Listenpunkt ebenfalls", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", " ```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Zaunzeile mit zwei Leerzeichen Einzug beendet den Zaun hinter einem nummerierten Listenpunkt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "1. ```", "  ```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Zaun hinter einem Listenpunkt mit zwei Leerzeichen nach dem Listenzeichen endet erst bei weniger Einzug als die Zaunzeile", async (context) => {
  const lauf = await pruefe(context, {
    issueText: ["## Vorlage", "", "-  ```", "  ```", FREIGABE_UEBERSCHRIFT, "", FREIGABEZEILE].join(
      "\n",
    ),
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Zaunzeile mit vier Leerzeichen schließt den Zaun hinter einem Listenpunkt, die nächste Zaunzeile öffnet einen neuen", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", "    ```", "  ```", FREIGABEZEILE, "  ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Überschrift direkt nach dem Codeblock eines Listenpunkts beendet den Freigabe-Abschnitt", async (context) => {
  const eingerueckt = `  ${BELIEBIGER_TEXT}`;
  const lauf = await pruefeAbschnitt(
    context,
    "- ```",
    eingerueckt,
    "## Notizen",
    "",
    FREIGABEZEILE,
  );
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabe-Überschrift direkt nach dem Codeblock eines Listenpunkts eröffnet einen Abschnitt", async (context) => {
  const lauf = await pruefe(context, {
    issueText: [
      "## Vorlage",
      "",
      "- ```",
      `  ${BELIEBIGER_TEXT}`,
      FREIGABE_UEBERSCHRIFT,
      "",
      FREIGABEZEILE,
    ].join("\n"),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("ein Tabulator vor der schließenden Zaunzeile hinter einem Listenpunkt schließt den Zaun, der nächste Zaun öffnet einen neuen Codeblock", async (context) => {
  const eingerueckt = `  ${FREIGABEZEILE}`;
  const lauf = await pruefeAbschnitt(context, "- ```", "\t```", "  ```", eingerueckt, "  ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Tabulator am Ende der schließenden Zaunzeile hinter einem Listenpunkt schließt den Zaun, der nächste Zaun öffnet einen neuen Codeblock", async (context) => {
  const eingerueckt = `  ${FREIGABEZEILE}`;
  const lauf = await pruefeAbschnitt(context, "- ```", "     ```\t", "  ```", eingerueckt, "  ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein geschütztes Leerzeichen hinter der Zaunzeile schließt den Codeblock nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", ZAUN_MIT_LEERZEICHEN, FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("zwei Tabulatoren vor einer Zaunzeile lassen den Zaun hinter einem Listenpunkt offen", async (context) => {
  const eingerueckt = `  ${FREIGABEZEILE}`;
  const lauf = await pruefeAbschnitt(context, "- ```", "\t\t```", eingerueckt, "  ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Zitat mit Codeblock zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> ```", `> ${FREIGABEZEILE}`, "> ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Zitat hinter einem Listenpunkt zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- > ```", `  > ${FREIGABEZEILE}`, "  > ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Listenpunkt innerhalb eines Zitats zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> - ```", `>   ${FREIGABEZEILE}`, ">   ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile nach einem Zitat mit Codeblock gilt weiter", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> ```", "> x", "> ```", "", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Freigabezeile in einem Codeblock hinter zwei Listenzeichen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- - ```", `    ${FREIGABEZEILE}`, "    ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Codeblock hinter einem nummerierten Listenpunkt in einem Listenpunkt zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "1. - ```", `     ${FREIGABEZEILE}`, "     ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem Codeblock hinter einem Listenzeichen mit Tabulator zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "-\t```", `\t${FREIGABEZEILE}`, "\t```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile unter vier Leerzeichen vor dem Listenzeichen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(
    context,
    "    - ```",
    `    ${BELIEBIGER_TEXT}`,
    `    ${FREIGABEZEILE}`,
  );
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einem Listenzeichen mit fünf Leerzeichen und Zaunzeile zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "-     ```", "      ```", `      ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein kürzerer Zaun schließt keinen längeren Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "````", "```", FREIGABEZEILE, "````");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Tilde-Zaun schließt keinen Codeblock aus Backticks", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", "~~~", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Zaunzeile mit Text dahinter schließt den Codeblock nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", "``` text", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Zaunzeile mit mehr als drei Leerzeichen über dem Einzug des Listenpunkts schließt den Zaun nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", "      ```", `  ${FREIGABEZEILE}`, "  ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein bis zum Ende offener Zaun hinter einem Listenpunkt macht den Rest zum Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", `  ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Backtick im Infotext macht die Zeile zu Text, die nächste Zaunzeile öffnet den Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "``` a`b", "```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem pre-Block zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<pre>", FREIGABEZEILE, "</pre>");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem details-Block zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<details>", "", FREIGABEZEILE, "", "</details>");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einem pre-Tag mitten in der Zeile zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "Text <pre>", FREIGABEZEILE, "</pre>");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein HTML-Block verdeckt einen Zaun, die Freigabezeile hinter dem nächsten Zaun zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<div>", "```", "", "```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile mit vier Leerzeichen Einzug nach einer Leerzeile zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `    ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile mit Tabulator Einzug nach einer Leerzeile zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `\t${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in einem eingerückten Codeblock hinter einem Listenpunkt zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- Punkt", "", `      ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile über einer Setext-Unterstreichung zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, FREIGABEZEILE, "---");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Zeile unter einer Setext-Überschrift gehört nicht zum Freigabe-Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, BELIEBIGER_TEXT, "===", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile vor einer waagerechten Linie gilt weiter", async (context) => {
  const lauf = await pruefeAbschnitt(context, FREIGABEZEILE, "", "---");
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Freigabezeile als Titel einer Linkdefinition zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `[Notiz]: https://example.org "${FREIGABEZEILE}"`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile im Label einer Linkdefinition über mehrere Zeilen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "[", `${FREIGABEZEILE}]: https://example.org`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile im Label einer Linkdefinition mit maskierter Klammer zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `[Notiz\\] ${FREIGABEZEILE}]: https://example.org`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile im Label einer Linkdefinition hinter einem Listenzeichen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `- [${FREIGABEZEILE}]: https://example.org`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile im Label einer Linkdefinition in einem Zitat über mehrere Zeilen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> [", `${FREIGABEZEILE}]: https://example.org`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eckige Klammern, die in der Zeile schließen, machen den Text nicht unsicher", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- [x] Notiz", "[Notiz] weiter", "", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("ein einzelnes Wagenrücklaufzeichen vor der Zaunzeile beginnt eine neue Zeile, die Freigabezeile im Codeblock zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "Text\r```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein einzelnes Wagenrücklaufzeichen hinter der Freigabe-Überschrift macht die Zeile dahinter nicht zur Freigabezeile", async (context) => {
  const lauf = await pruefe(context, { issueText: `${FREIGABE_UEBERSCHRIFT}\r${FREIGABEZEILE}` });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein einzelnes Wagenrücklaufzeichen vor der Freigabe-Überschrift macht sie nicht zur Überschrift", async (context) => {
  const lauf = await pruefe(context, {
    issueText: `##\r${FREIGABE_UEBERSCHRIFT}\n\n${FREIGABEZEILE}`,
  });
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein nicht geschlossener Kommentar in einem Codeblock verwirft die Freigabezeile hinter dem Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", "<!--", "```", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Kommentaranfang mit überlappendem Schluss in einem Tilde-Codeblock verwirft die Freigabezeile dahinter", async (context) => {
  const lauf = await pruefeAbschnitt(context, "~~~", "<!--->", "~~~", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein nicht geschlossener Kommentar in einem Codeblock im Listenpunkt verwirft die Freigabezeile dahinter", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ```", "  <!-->", "  ```", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein geschlossener Kommentar in einem Codeblock lässt die Freigabezeile dahinter gelten", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", "<!-- c -->", "```", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Überschrift in einem Codeblock hinter einem Listenzeichen beendet den Freigabe-Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ~~~", "  ## Notizen", "  ~~~", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Überschrift in einem Codeblock hinter einer Listennummer beendet den Freigabe-Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "1. ```", "   # Titel", "   ```", "", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Zeile mit vier Leerzeichen Einzug in einem Codeblock hinter einem Listenzeichen ist keine Überschrift", async (context) => {
  const lauf = await pruefeAbschnitt(
    context,
    "- ```",
    "    ## Notizen",
    "  ```",
    "",
    FREIGABEZEILE,
  );
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Überschrift in einem Codeblock am Zeilenanfang beendet den Freigabe-Abschnitt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", "## Notizen", "```", "", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("ein Kommentar hinter einer Zaunzeile im Codeblock schließt den Codeblock nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "```", "``` <!-- c -->", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Kommentar vor einer Zaunzeile macht sie nicht zum Zaun, die nächste Zaunzeile öffnet den Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<!-- c -->```", "```", FREIGABEZEILE, "```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile nach einem Kommentar in einer eigenen Zeile gilt weiter", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<!-- c -->", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("ein nicht geschlossener Kommentar mitten in einer Zeile verwirft die folgende Überschrift nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "Text <!--", "## Andere", `--> ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein nicht geschlossener Kommentar hinter einem Listenzeichen verwirft die folgende Überschrift nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "* <!--", "## Andere", `--> ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein nicht geschlossener Kommentar in einem Zitat verwirft die folgende Überschrift nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> <!--", "## Andere", `--> ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein nicht geschlossener Kommentar mit Einzug im Listenpunkt verwirft die folgende Überschrift nicht", async (context) => {
  const lauf = await pruefeAbschnitt(
    context,
    "- Punkt",
    "  <!--",
    "## Andere",
    `--> ${FREIGABEZEILE}`,
  );
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Kommentar, dessen Schluss den Anfang überlappt, verwirft die folgende Überschrift nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<!-->", "## Andere", `--> ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Kommentar mitten in einer Zeile, der in der Zeile schließt, lässt die Freigabezeile gelten", async (context) => {
  const lauf = await pruefeAbschnitt(context, "Text <!-- c --> mehr", "", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("ein Kommentar mit einem Tabulator Einzug unterbricht keinen Absatz, die Setext-Unterstreichung danach macht die Zeile davor zur Überschrift", async (context) => {
  const lauf = await pruefeAbschnitt(context, FREIGABEZEILE, "\t<!-- c -->", "---");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Kommentar mit vier Leerzeichen Einzug unterbricht keinen Absatz, die Setext-Unterstreichung danach macht die Zeile davor zur Überschrift", async (context) => {
  const lauf = await pruefeAbschnitt(context, FREIGABEZEILE, "    <!-- c -->", "---");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile nach einem mehrzeiligen Kommentar mit Zaunzeile gilt weiter", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<!--", "```", "-->", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Überschrift mit Einzug in einem Listenpunkt beendet den Freigabe-Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- Punkt", "    ## Notizen", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Überschrift hinter einem Listenzeichen beendet den Freigabe-Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- ## Notizen", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Überschrift in einem Zitat beendet den Freigabe-Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> ## Notizen", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine leere Überschrift beendet den Freigabe-Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "##", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine nummerierte Zeile mit Nummer ungleich 1 unterbricht keinen Absatz, die Zaunzeile danach öffnet den Codeblock", async (context) => {
  const lauf = await pruefeAbschnitt(context, "Text", "2. ```", "   ```", FREIGABEZEILE, "   ```");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Zaun mit Einzug im Listenpunkt wird von einer Zaunzeile ohne Einzug nicht geschlossen", async (context) => {
  const lauf = await pruefeAbschnitt(
    context,
    "- Punkt",
    "  ```",
    "  x",
    "```",
    FREIGABEZEILE,
    "```",
  );
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile vor einem HTML-Tag zählt nicht, wenn danach eine Setext-Unterstreichung folgt", async (context) => {
  const lauf = await pruefeAbschnitt(context, FREIGABEZEILE, "</pre>", "---");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Autolink in spitzen Klammern macht den Text nicht unsicher", async (context) => {
  const lauf = await pruefeAbschnitt(context, "<https://example.org>", "", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Freigabezeile nach einem HTML-Tag in einem Zitat zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> <pre>", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile nach einem Zitat ohne HTML-Tag gilt weiter", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> Zitat", "", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Freigabezeile hinter einem Listenzeichen und fünf Leerzeichen ist eingerückter Code und zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `-     ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einem Listenzeichen, einem Tabulator und zwei Leerzeichen ist eingerückter Code und zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `-\t  ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einer Listennummer und fünf Leerzeichen ist eingerückter Code und zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `1.     ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einem Listenzeichen und vier Leerzeichen bleibt Text", async (context) => {
  const lauf = await pruefeAbschnitt(context, `-    ${FREIGABEZEILE}`);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("eine Freigabezeile im Infotext eines Zauns in einem Zitat hinter einem Listenzeichen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `- >~~~${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Setext-Unterstreichung in einem Zitat macht den Absatz im Zitat zur Überschrift und beendet den Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, ">Zitat", ">-", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Setext-Unterstreichung mit Gleichheitszeichen in einem Zitat beendet den Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "> Zitat", "> ===", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Setext-Unterstreichung mit vier Leerzeichen Einzug in einem Zitat beendet den Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, ">Zitat", ">    ---", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Setext-Unterstreichung mit vier Leerzeichen Einzug in einem Listenpunkt beendet den Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- Punkt", "    ---", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Setext-Unterstreichung mit Tabulator in einem Listenpunkt beendet den Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- Punkt", "\t===", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Setext-Unterstreichung mit Einzug in einem nummerierten Listenpunkt beendet den Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, "1. Punkt", "     ---", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile als Text einer Überschrift mit Setext-Unterstreichung im Listenpunkt zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `- ${FREIGABEZEILE}`, "    ---");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in der überzähligen Zelle einer Tabellenzeile zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "Text", "|-", `x|${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in der überzähligen Zelle einer Tabelle mit zwei Spalten zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "a|b", "-|-", `x|y|${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in der überzähligen Zelle einer Tabelle mit Doppelpunkt in der Trennzeile zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "Text", ":-", `x|${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile in der überzähligen Zelle einer Tabelle in einem Listenpunkt zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, "- Text", "  |-", `  x|${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein senkrechter Strich im Text ohne Trennzeile macht den Text nicht unsicher", async (context) => {
  const lauf = await pruefeAbschnitt(context, "a | b", "", FREIGABEZEILE);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("ein Kommentaranfang hinter einem Backslash ist kein Kommentar, der überlappende Schluss danach macht den Rest unsicher", async (context) => {
  const lauf = await pruefeAbschnitt(context, "\\<!--<!--->", FREIGABEZEILE, "", "<!--->");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einem Zitatzeichen im Listenpunkt und fünf Leerzeichen ist eingerückter Code und zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `* >     ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter zwei Zitatzeichen im Listenpunkt und fünf Leerzeichen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `- >>     ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einem Zitatzeichen im Listenpunkt, einem Leerzeichen, einem Tabulator und einem Leerzeichen zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, `- > \t ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine Freigabezeile hinter einem Zitatzeichen im Listenpunkt und vier Leerzeichen bleibt Text", async (context) => {
  const lauf = await pruefeAbschnitt(context, `- >    ${FREIGABEZEILE}`);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
});

test("ein Zitatzeichen hinter einem Listenzeichen und fünf Leerzeichen macht die Zeile zum eingerückten Code", async (context) => {
  const lauf = await pruefeAbschnitt(context, `-     >${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Zitatzeichen hinter einer Listennummer, einem Tabulator und drei Leerzeichen macht die Zeile zum eingerückten Code", async (context) => {
  const lauf = await pruefeAbschnitt(context, `1.\t   >${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein zweites Listenzeichen hinter einem Listenzeichen und fünf Leerzeichen macht die Zeile zum eingerückten Code", async (context) => {
  const lauf = await pruefeAbschnitt(context, `-     - ${FREIGABEZEILE}`);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Listenzeichen mit Leerzeichen hinter dem Zitatzeichen unterstreicht den Absatz im Zitat, die Zeile davor zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, ">Zitat", FREIGABEZEILE, ">- ");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Listenzeichen mit Tabulator hinter dem Zitatzeichen unterstreicht den Absatz im Zitat, die Zeile davor zählt nicht", async (context) => {
  const lauf = await pruefeAbschnitt(context, ">Zitat", FREIGABEZEILE, ">-\t");
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Listenzeichen mit Leerzeichen in einer eigenen Zitatzeile unterstreicht den Absatz im Zitat und beendet den Abschnitt", async (context) => {
  const lauf = await pruefeAbschnitt(context, ">Zitat", "> - ", FREIGABEZEILE);
  assert.ok(blockiert(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("ein Closes auf die Nummer eines PRs neben dem Closes auf das freigebende Issue bricht die Prüfung nicht ab", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    prText: `Closes #${FREMDE_PR}\n${VERKNUEPFT}`,
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, FREIGEGEBEN);
  assert.doesNotMatch(lauf.stdout + lauf.zusammenfassung, new RegExp(`#${FREMDE_PR}\\b`));
});

test("ein Closes allein auf die Nummer eines PRs gibt nichts frei, auch wenn dessen Text einen Freigabe-Abschnitt trägt", async (context) => {
  const lauf = await pruefe(context, {
    issueText: FREIGABE_FUER_FUNDLISTE,
    prText: `Closes #${FREMDE_PR}`,
  });
  assert.ok(blockiertOhneFreigabe(lauf), lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.zusammenfassung, NICHT_ANGEKUENDIGT);
});

test("eine andere GraphQL-Fehlermeldung als die für PR-Nummern bricht die Prüfung weiter ab", async (context) => {
  const message = `Could not resolve to an issue or pull request with the number of ${ISSUE}.`;
  const lauf = await pruefeAbbruch(context, { graphqlFehler: message });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes(`${ABBRUCH} Die GitHub-API meldet: ${message}`), lauf.stderr);
  assert.doesNotMatch(lauf.stdout, FREIGABE_AUSNAHME);
});

test("ein HTTP-Fehler der GitHub-Abfrage bricht die Prüfung weiter ab", async (context) => {
  const lauf = await pruefeAbbruch(context, { ohneGraphql: true });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes(`${ABBRUCH} Die GitHub-API antwortet mit HTTP 404.`), lauf.stderr);
  assert.doesNotMatch(lauf.stdout, FREIGABE_AUSNAHME);
});
