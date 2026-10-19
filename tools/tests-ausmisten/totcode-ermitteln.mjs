import { env } from "node:process";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { CI_LAUF, ausloesenderLauf, stammtAus } from "../auftrag/pruefer-herkunft.mjs";
import {
  DEAD_CODE_LIST_HEADING,
  ISSUE_QUERY,
  hasHeading,
  issueList,
} from "../testschutz/freigabe.mjs";
import { closedIssueNumbers, graphql } from "../testschutz/github.mjs";
import { setzeAusgaben } from "../ziele/ausgabe.mjs";
import { laufFehler } from "./herkunft.mjs";
import { aenderungen, git, gitGelingt } from "./pfade.mjs";

const EXIT_GRUEN = 0;
const ZIELBRANCH = "master";
const OFFEN = "open";
const GELOESCHT = "D";
const TESTORDNER = "test/";
const PHASEN_BRANCH = /^phase\/([1-9]\d{0,8})-([\w-][\w.-]*)$/;

export function totcodeLaufFehler(lauf) {
  return laufFehler(lauf, CI_LAUF, {
    art: "pull_request-Lauf",
    fremd: "der PR kommt aus einem Fork",
  });
}

function prFehler(pr, kopf) {
  if (pr.state !== OFFEN) return `PR #${pr.number} ist nicht offen`;
  if (pr.head?.sha !== kopf) return `PR #${pr.number} steht nicht mehr auf ${kopf}`;
  if (pr.base?.ref !== ZIELBRANCH) return `PR #${pr.number} zielt nicht auf ${ZIELBRANCH}`;
  const basisRepo = pr.base.repo?.id;
  if (!Number.isInteger(basisRepo) || pr.head.repo?.id !== basisRepo)
    return `PR #${pr.number} kommt aus einem Fork`;
  return undefined;
}

async function prDes(github, lauf) {
  const nummer = lauf.pull_requests?.[0]?.number;
  if (!Number.isInteger(nummer)) return { fehler: "der CI-Lauf nennt keinen PR" };
  const pr = await github.hole(`/pulls/${nummer}`);
  const fehler = prFehler(pr, lauf.head_sha);
  return fehler ? { fehler } : { pr };
}

export function geloeschteTests(master, kopf) {
  const gemeinsam = git(["merge-base", master, kopf]).trim();
  return aenderungen(gemeinsam, kopf)
    .filter(({ status, pfad }) => status === GELOESCHT && pfad.startsWith(TESTORDNER))
    .map(({ pfad }) => pfad);
}

async function totcodeIssues(body, issueLesen) {
  const issues = await Promise.all(closedIssueNumbers(body).map(issueLesen));
  return issues.filter((issue) => issue != null && hasHeading(issue.body, DEAD_CODE_LIST_HEADING));
}

function phaseDesBranches(ref) {
  const treffer = PHASEN_BRANCH.exec(ref ?? "");
  return treffer === null ? undefined : { issue: Number(treffer[1]), phase: treffer[2] };
}

function phasenDatei(master, phase) {
  const pfad = `plaene/${phase}/phase.json`;
  try {
    return { pfad, inhalt: JSON.parse(git(["show", `${master}:${pfad}`])) };
  } catch {
    return { pfad };
  }
}

function listenFehler(issues, { issue, phase }, master) {
  const nummern = issues.map(({ number }) => `#${number}`).join(", ") || "keins";
  if (issues.length !== 1 || issues[0].number !== issue)
    return `das einzige verknüpfte Issue mit „${DEAD_CODE_LIST_HEADING}“ muss #${issue} aus dem Branch sein (gefunden: ${nummern})`;
  const { pfad, inhalt } = phasenDatei(master, phase);
  if (inhalt === undefined) return `${pfad} fehlt auf master ${master} oder ist kein JSON`;
  if (inhalt.issue !== issue) return `${pfad} auf master ${master} nennt nicht Issue #${issue}`;
  return undefined;
}

function totcodeListe(issues, phase, master) {
  const fehler = listenFehler(issues, phase, master);
  if (fehler) return { liste: [], fehler };
  const { problem, names } = issueList(issues[0], DEAD_CODE_LIST_HEADING);
  return { liste: problem === undefined ? names : [], fehler: problem };
}

function nichtNoetig(grund) {
  return { noetig: false, grund };
}

export async function ermittle({ lauf, master, github, issueLesen }) {
  const fehler = totcodeLaufFehler(lauf);
  if (fehler) return nichtNoetig(fehler);
  if (!(await stammtAus(github, lauf, CI_LAUF)))
    return nichtNoetig("die Workflow-Nummer gehört nicht zu ci.yml");
  const { pr, fehler: keinPr } = await prDes(github, lauf);
  if (keinPr) return nichtNoetig(keinPr);
  const phase = phaseDesBranches(pr.head.ref);
  if (phase === undefined) return nichtNoetig("der Kopf ist kein Branch phase/<issue>-<phase>");
  const kopf = lauf.head_sha;
  const geloescht = geloeschteTests(master, kopf);
  const issues = await totcodeIssues(pr.body, issueLesen);
  if (geloescht.length === 0 && issues.length === 0)
    return nichtNoetig(
      `der PR löscht keine Datei unter ${TESTORDNER}, kein verknüpftes Issue trägt „${DEAD_CODE_LIST_HEADING}“`,
    );
  const aufMaster = gitGelingt(["merge-base", "--is-ancestor", master, kopf]);
  const liste = totcodeListe(issues, phase, master);
  return { noetig: true, pr: pr.number, kopf, aufMaster, geloescht, ...liste };
}

async function issueAusGraphql(nummer) {
  return (await graphql(ISSUE_QUERY, nummer)).issue;
}

export async function ermitteln() {
  const ergebnis = await ermittle({
    lauf: ausloesenderLauf(),
    master: env.GITHUB_SHA ?? "",
    github: githubZugang({ token: env.GITHUB_TOKEN ?? "" }),
    issueLesen: issueAusGraphql,
  });
  if (!ergebnis.noetig) {
    console.log(`Totcode-Messung nicht nötig: ${ergebnis.grund}.`);
    setzeAusgaben({ noetig: "false" });
    return EXIT_GRUEN;
  }
  for (const pfad of ergebnis.geloescht) console.log(`Gelöscht: ${pfad}`);
  if (ergebnis.fehler) console.log(`Totcode-Liste ungültig: ${ergebnis.fehler}`);
  console.log(`Totcode-Messung nötig für PR #${ergebnis.pr} auf ${ergebnis.kopf}.`);
  setzeAusgaben({
    noetig: "true",
    pr: ergebnis.pr,
    aufmaster: String(ergebnis.aufMaster),
    fehler: ergebnis.fehler ?? "",
    liste: JSON.stringify(ergebnis.liste),
  });
  return EXIT_GRUEN;
}
