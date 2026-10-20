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
  return scheinGithub(
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
      ["POST /graphql", { data: { repository: { issue, pullRequest } } }],
    ]),
  );
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
    .filter(({ pfad, rumpf }) => pfad === "/graphql" && rumpf.query.includes("issue("))
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
