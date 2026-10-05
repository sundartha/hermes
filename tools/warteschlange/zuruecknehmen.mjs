import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { ciLauf, git, schreibeAusgabe } from "./gleicher-stand.mjs";
import { eintraegeAus, leseBelege } from "./wackelig-issues.mjs";

const BOT = "sundartha-bot";
const BOT_ADRESSE = "335012687+sundartha-bot@users.noreply.github.com";
const MASTER = "master";
const RUECKNAHME_PRAEFIX = "revert/";
const WORKFLOW_ORDNER = ".github/workflows/";
const ROTE_GRUENDE = new Set([
  "zweimal rot",
  "Safety-Gate-Test, kein zweiter Lauf",
  "Bedrohungskatalog, kein zweiter Lauf",
]);
const GRAPHQL_STANDARD = "https://api.github.com/graphql";
const EINREIHEN =
  "mutation($id: ID!) { enqueuePullRequest(input: { pullRequestId: $id, jump: true }) { clientMutationId } }";
const KURZ = 7;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

export const ROT = "master-rot";

export function zweimalRoteTests(ordner, root) {
  const rote = eintraegeAus(leseBelege(ordner), "rot", root);
  const zweimalRot = rote.filter(({ grund }) => ROTE_GRUENDE.has(grund));
  return zweimalRot.sort((links, rechts) => links.datei.localeCompare(rechts.datei));
}

async function gemergtePrs(github, sha) {
  const pulls = await github.hole(`/commits/${sha}/pulls`);
  return pulls.filter((pull) => pull.merged_at && pull.base?.ref === MASTER);
}

export async function bereichZumLauf(github, sha, root) {
  const [pr] = await gemergtePrs(github, sha);
  if (pr === undefined) return { grund: `kein gemergter PR zu ${sha.slice(0, KURZ)}` };
  const anzahl = Number(pr.commits);
  const liste = git(["rev-list", "--first-parent", `--max-count=${anzahl}`, sha], { root })
    .split("\n")
    .filter(Boolean);
  for (const commit of liste) {
    const zugehoerig = await gemergtePrs(github, commit);
    if (!zugehoerig.some(({ number }) => number === pr.number)) {
      return { pr, grund: "Bereich unklar" };
    }
  }
  if (liste.length !== anzahl) return { pr, grund: "Bereich unklar" };
  return { pr, aelteste: liste.at(-1), kopf: sha };
}

async function offeneRuecknahme(github, pr) {
  const [besitzer] = github.repo.split("/");
  const kopf = `${besitzer}:${RUECKNAHME_PRAEFIX}${pr.number}`;
  const offen = await github.hole(`/pulls?state=open&head=${encodeURIComponent(kopf)}`);
  return offen[0] ?? null;
}

function geaenderteDateien({ aelteste, kopf }, root) {
  const ausgabe = git(["diff", "--name-only", "--no-renames", `${aelteste}^`, kopf], { root });
  return ausgabe.split("\n").filter(Boolean);
}

async function hindernis(github, { lauf, bereich, ordner }, root) {
  const { pr } = bereich;
  if (bereich.grund) return { art: ROT, wert: bereich.grund };
  if (pr.head?.ref?.startsWith(RUECKNAHME_PRAEFIX)) {
    return { art: ROT, wert: `master ist auch nach der Rücknahme #${pr.number} rot` };
  }
  if (pr.merge_commit_sha !== lauf.head_sha) {
    return { art: ROT, wert: `der rote Lauf liegt nicht auf dem gemergten Stand von #${pr.number}` };
  }
  const laufend = await offeneRuecknahme(github, pr);
  if (laufend !== null) return { art: "laeuft", wert: String(laufend.number) };
  if (zweimalRoteTests(ordner, root).length === 0) {
    return { art: ROT, wert: "kein Test ist zweimal rot; keine Rücknahme ohne roten Test" };
  }
  if (geaenderteDateien(bereich, root).some((pfad) => pfad.startsWith(WORKFLOW_ORDNER))) {
    return { art: ROT, wert: `#${pr.number} ändert Workflow-Dateien; das Token darf sie nicht ändern` };
  }
  return null;
}

function nimmZurueck({ aelteste, kopf }, root) {
  const identitaet = ["-c", `user.name=${BOT}`, "-c", `user.email=${BOT_ADRESSE}`];
  const lauf = spawnSync("git", [...identitaet, "revert", "--no-edit", `${aelteste}^..${kopf}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (lauf.status === 0) return true;
  spawnSync("git", ["revert", "--abort"], { cwd: root });
  return false;
}

function schiebe(nummer, root) {
  const helfer = "!f() { echo username=x-access-token; echo \"password=$BOT_TOKEN\"; }; f";
  const umgebung = {
    ...env,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: helfer,
  };
  const ziel = `HEAD:refs/heads/${RUECKNAHME_PRAEFIX}${nummer}`;
  const lauf = spawnSync("git", ["push", "--quiet", "origin", ziel], { cwd: root, env: umgebung });
  if (lauf.status !== 0) throw new Error(`git push nach ${RUECKNAHME_PRAEFIX}${nummer} ist gescheitert`);
}

async function vorneEinreihen(neu) {
  const adresse = env.GITHUB_GRAPHQL_URL || GRAPHQL_STANDARD;
  try {
    const antwort = await fetch(adresse, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: EINREIHEN, variables: { id: neu.node_id } }),
    });
    const { errors } = await antwort.json();
    if (antwort.ok && !errors?.length) return true;
    console.log(`Vordrängeln nicht möglich: ${errors?.[0]?.message ?? `HTTP ${antwort.status}`}`);
  } catch (fehler) {
    console.log(`Vordrängeln nicht möglich: ${fehler.message}`);
  }
  return false;
}

function einreihen(neu, repo) {
  const gh = env.HERMES_GH ?? "gh";
  const lauf = spawnSync(gh, ["pr", "merge", String(neu.number), "--repo", repo, "--auto"], {
    env: { ...env, GH_TOKEN: env.BOT_TOKEN },
    encoding: "utf8",
  });
  return lauf.status === 0;
}

function ruecknahmeText({ lauf, bereich }) {
  return [
    `Rücknahme von #${bereich.pr.number}, weil der Lauf von „CI“ auf master rot ist: ${lauf.html_url}`,
    "",
    `Zurückgenommen: ${bereich.aelteste}^..${bereich.kopf} (${bereich.pr.commits} Commits).`,
    "Der Rücknahme-PR durchläuft dieselben Pflicht-Checks wie jeder PR.",
    "",
  ].join("\n");
}

async function legeRuecknahmeAn({ lauf, bereich }, root, github) {
  if (!nimmZurueck(bereich, root)) {
    return { art: ROT, wert: `Konflikt beim Zurücknehmen von #${bereich.pr.number}` };
  }
  schiebe(bereich.pr.number, root);
  const bot = githubZugang({ token: env.BOT_TOKEN });
  const neu = await bot.sende("POST", "/pulls", {
    title: `Rücknahme von #${bereich.pr.number}`,
    head: `${RUECKNAHME_PRAEFIX}${bereich.pr.number}`,
    base: MASTER,
    body: ruecknahmeText({ lauf, bereich }),
  });
  const vorne = await vorneEinreihen(neu);
  if (!einreihen(neu, github.repo) && !vorne) {
    throw new Error(`gh pr merge ${neu.number} --auto ist gescheitert`);
  }
  return { art: "zurueckgenommen", wert: String(neu.number) };
}

export async function zuruecknehmen({ ordner }, root, github = githubZugang()) {
  const lauf = await ciLauf(github, ["push"]);
  if (lauf === null || lauf.head_branch !== MASTER || lauf.conclusion !== "failure") {
    console.error("Der auslösende Lauf ist kein roter Push-Lauf von ci.yml auf master.");
    return EXIT_FEHLER;
  }
  const bereich = await bereichZumLauf(github, lauf.head_sha, root);
  const ergebnis =
    (await hindernis(github, { lauf, bereich, ordner }, root)) ??
    (await legeRuecknahmeAn({ lauf, bereich }, root, github));
  schreibeAusgabe({ ergebnis: `${ergebnis.art}:${ergebnis.wert}` });
  console.log(`Rücknahme: ${ergebnis.art}: ${ergebnis.wert}`);
  return EXIT_OK;
}
