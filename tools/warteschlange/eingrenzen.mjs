import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { env } from "node:process";

import { imBereich, istTestdatei } from "../auftrag/format.mjs";
import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { ciLauf, git } from "./gleicher-stand.mjs";
import { meldeMasterRot } from "./melden.mjs";
import { ROT, bereichZumLauf, zweimalRoteTests } from "./zuruecknehmen.mjs";

const ERGEBNIS_MUSTER = /^(zurueckgenommen|master-rot|laeuft):(.*)$/s;
const AUFTRAG_ZEILE = /^Auftrag: (\S+\/\S+)$/m;
const OHNE_ERGEBNIS = "die Rücknahme hat kein Ergebnis gemeldet (abgebrochen oder gescheitert)";
const REPARATUR = "reparatur";
const MAX_ZIEL = 72;
const KURZ = 12;
const JSON_EINZUG = 2;
const CODEBLOCK = "```";
const NIE = {
  wiederholung: "Der rote Test wird nicht verändert, abgeschwächt oder übersprungen.",
  gleichzeitig: "Die Reparatur ändert kein Verhalten außerhalb des zurückgenommenen PRs.",
  zeitueberschreitung: "Kein Test wird langsamer, weil die Reparatur wartet.",
  abbruch: "Ein Abbruch hinterlässt keinen halb übernommenen Stand im Commit.",
};
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

function gelesenesErgebnis(text) {
  const treffer = ERGEBNIS_MUSTER.exec(String(text ?? ""));
  return treffer === null ? { art: ROT, wert: OHNE_ERGEBNIS } : { art: treffer[1], wert: treffer[2] };
}

function pruefbefehl(datei) {
  if (env.HERMES_BISEKT_BEFEHL) return [env.HERMES_BISEKT_BEFEHL, datei];
  return ["npm", "test", "--", datei];
}

function ohneZweitenLauf() {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== "TESTS_ZWEITER_LAUF"));
}

function arbeitsbaum(root, kopf) {
  const ordner = mkdtempSync(join(tmpdir(), "eingrenzen-"));
  const baum = join(ordner, "baum");
  git(["worktree", "add", "--detach", "--quiet", baum, kopf], { root });
  if (existsSync(join(root, "node_modules"))) {
    symlinkSync(join(root, "node_modules"), join(baum, "node_modules"));
  }
  const aufraeumen = () => {
    spawnSync("git", ["bisect", "reset", "--quiet"], { cwd: baum });
    spawnSync("git", ["worktree", "remove", "--force", baum], { cwd: root });
    rmSync(ordner, { recursive: true, force: true });
  };
  return { baum, aufraeumen };
}

function bisektion({ aelteste, kopf }, datei, root) {
  const { baum, aufraeumen } = arbeitsbaum(root, kopf);
  try {
    git(["bisect", "start", kopf, `${aelteste}^`], { root: baum });
    const lauf = spawnSync("git", ["bisect", "run", ...pruefbefehl(datei)], {
      cwd: baum,
      env: ohneZweitenLauf(),
      encoding: "utf8",
    });
    if (lauf.status !== 0) return null;
    return git(["rev-parse", "refs/bisect/bad"], { root: baum }).trim();
  } finally {
    aufraeumen();
  }
}

function herkunftDes(schuldig, root) {
  const [kopfzeile] = git(["show", "--no-patch", "--format=%H %s", schuldig], { root }).split("\n");
  const auftrag = AUFTRAG_ZEILE.exec(git(["log", "-1", "--format=%B", schuldig], { root }))?.[1];
  const dateien = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", schuldig], {
    root,
  })
    .split("\n")
    .filter(Boolean);
  return { kopfzeile, auftrag: auftrag ?? null, dateien };
}

function gemeinsamerOrdner(pfade) {
  const teile = pfade.map((pfad) => dirname(pfad).split("/"));
  const gemeinsam = [];
  for (const [stelle, teil] of teile[0].entries()) {
    if (teil === "." || !teile.every((andere) => andere[stelle] === teil)) break;
    gemeinsam.push(teil);
  }
  return gemeinsam.length === 0 ? null : `${gemeinsam.join("/")}/`;
}

function bereichAus(dateien) {
  const code = dateien.filter((pfad) => !istTestdatei(pfad));
  const grundlage = code.length > 0 ? code : dateien;
  if (grundlage.length === 1) return grundlage[0];
  return gemeinsamerOrdner(grundlage) ?? grundlage[0];
}

function phaseFuer({ pr, datei, herkunft }, issue) {
  const bereich = bereichAus(herkunft.dateien);
  const entwurf = [
    `master war nach dem Merge von #${pr.number} rot; die Rücknahme hat die Commits des PRs entfernt.`,
    "Die Phase übernimmt die zurückgenommenen Commits des PRs auf dem neuen master und behebt den roten Test.",
    `Eingeführt mit: ${herkunft.kopfzeile}`,
  ].join("\n");
  return {
    phase: `reparatur-${pr.number}`,
    issue,
    entwurf: { [bereich]: entwurf },
    auftraege: [
      {
        id: "reparatur",
        art: "fehlerbehebung",
        ziel: `Übernimm #${pr.number} ohne den roten Test ${datei}`.slice(0, MAX_ZIEL),
        bereich,
        erwarteteDateien: herkunft.dateien.filter(
          (pfad) => imBereich(bereich, pfad) || istTestdatei(pfad),
        ),
        vorbild: datei,
        abnahme: datei,
        erwarteterFehler: "ERR_ASSERTION",
        wasDarfNiePassieren: NIE,
      },
    ],
  };
}

function reparaturText({ pr, lauf, datei, herkunft, neu }) {
  const zeilen = [
    `master war nach dem Merge von #${pr.number} rot (${lauf.html_url}). Die Rücknahme ist #${neu}.`,
    `Roter Test: \`${datei}\``,
    herkunft === null
      ? "Eingrenzung ohne Ergebnis: git bisect hat keinen Commit genannt."
      : `Eingeführt mit: ${herkunft.kopfzeile}`,
  ];
  if (herkunft?.auftrag) zeilen.push(`Auftrag: ${herkunft.auftrag}`);
  return `${zeilen.join("\n")}\n`;
}

function vorlageText(text, phase) {
  return [
    text,
    "Die Fehlerbehebung startet die nächste Bot-Sitzung mit dieser Phasen-Vorlage (`node tools/auftrag.mjs phase <datei>`):",
    "",
    `${CODEBLOCK}json`,
    JSON.stringify(phase, null, JSON_EINZUG),
    CODEBLOCK,
    "",
  ].join("\n");
}

async function roterSchritt(github, lauf) {
  const { jobs = [] } = await github.hole(`/actions/runs/${lauf.id}/jobs`);
  const job = jobs.find(({ conclusion }) => conclusion === "failure");
  const schritt = job?.steps?.find(({ conclusion }) => conclusion === "failure");
  return job === undefined ? "unbekannt" : `${job.name}, Schritt ${schritt?.name ?? "unbekannt"}`;
}

async function reparaturIssue(github, angaben, root) {
  const [rot] = zweimalRoteTests(angaben.ordner, root);
  const { pr } = angaben.bereich;
  if (rot === undefined) {
    const schritt = await roterSchritt(github, angaben.lauf);
    await github.sende("POST", "/issues", {
      title: `Reparatur nach Rücknahme von #${pr.number}`,
      body: `master war nach dem Merge von #${pr.number} rot (${angaben.lauf.html_url}). Rot war: ${schritt}.\n`,
      labels: [REPARATUR],
    });
    return;
  }
  const schuldig = bisektion(angaben.bereich, rot.datei, root);
  const herkunft = schuldig === null ? null : herkunftDes(schuldig, root);
  const text = reparaturText({ ...angaben, pr, datei: rot.datei, herkunft });
  const issue = await github.sende("POST", "/issues", {
    title: `Reparatur: ${rot.datei} nach Rücknahme von #${pr.number}`,
    body: text,
    labels: [REPARATUR],
  });
  if (herkunft === null) return;
  const phase = phaseFuer({ pr, datei: rot.datei, herkunft }, issue.number);
  await github.sende("PATCH", `/issues/${issue.number}`, { body: vorlageText(text, phase) });
  console.log(`Reparatur-Issue #${issue.number}: ${herkunft.kopfzeile.slice(0, KURZ)}`);
}

export async function eingrenzen({ ergebnis, ordner }, root, github = githubZugang()) {
  const lauf = await ciLauf(github, ["push"]);
  if (lauf === null) {
    console.error("Der auslösende Lauf ist kein Push-Lauf von ci.yml.");
    return EXIT_FEHLER;
  }
  const { art, wert } = gelesenesErgebnis(ergebnis);
  if (art === "laeuft") {
    console.log(`Eine Rücknahme läuft schon: #${wert}`);
  } else if (art === ROT) {
    await meldeMasterRot(github, { lauf, grund: wert });
  } else {
    const bereich = await bereichZumLauf(github, lauf.head_sha, root);
    await reparaturIssue(github, { lauf, bereich, ordner, neu: wert }, root);
  }
  return EXIT_OK;
}
