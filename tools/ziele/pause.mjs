import { IDS, befund, istVomBot } from "./befunde.mjs";
import { istGruen, issuesMitLabel, letzterCiLauf } from "./github.mjs";
import { ruecknahmen } from "./ruecknahmen.mjs";

const REPARATUR = "reparatur";
const MASTER_ROT = "master-rot";
const ERLEDIGT = "completed";
const GESCHLOSSEN = "closed";

async function prNummer(github, sha) {
  const prs = await github.hole(`/commits/${sha}/pulls`);
  return prs.find((pr) => pr.merged_at)?.number ?? prs[0]?.number ?? null;
}

function nenntPr(text, nummer) {
  return new RegExp(`#${nummer}(?!\\d)`).test(text ?? "");
}

function issueZu(nummer, { reparatur, masterRot }) {
  const passend = reparatur.find((issue) => new RegExp(`nach Rücknahme von #${nummer}$`).test(issue.title));
  return passend ?? masterRot.find((issue) => nenntPr(issue.title, nummer) || nenntPr(issue.body, nummer));
}

function erledigt(issue) {
  return issue.state === GESCHLOSSEN && issue.state_reason === ERLEDIGT;
}

async function lageDer(github, eintrag, issues) {
  const nummer = await prNummer(github, eintrag.original);
  const issue = nummer === null ? undefined : issueZu(nummer, issues);
  const wer = nummer === null ? `Commit ${eintrag.original}` : `#${nummer}`;
  if (issue === undefined) {
    const text = `Die Rücknahme von ${wer} (Sorte ${eintrag.sorte}) hat weder ein Reparatur- noch ein master-rot-Issue; die Sorte bleibt pausiert.`;
    return { grund: `Rücknahme von ${wer} ohne Reparatur-Issue`, befund: befund(IDS.pause, eintrag.datei, text) };
  }
  if (!erledigt(issue)) return { grund: `Issue #${issue.number} zur Rücknahme von ${wer} ist nicht erledigt` };
  return null;
}

export async function pausierteSorten({ github, root }) {
  const liste = ruecknahmen(root);
  const pausiert = new Map();
  const befunde = [];
  if (liste.length === 0) return { pausiert, befunde };
  const issues = {
    reparatur: (await issuesMitLabel(github, REPARATUR)).filter(istVomBot),
    masterRot: (await issuesMitLabel(github, MASTER_ROT)).filter(istVomBot),
  };
  for (const eintrag of liste) {
    const lage = await lageDer(github, eintrag, issues);
    if (lage === null) continue;
    if (!pausiert.has(eintrag.sorte)) pausiert.set(eintrag.sorte, lage.grund);
    if (lage.befund) befunde.push(lage.befund);
  }
  const gruen = istGruen(await letzterCiLauf(github, { abgeschlossen: true }));
  for (const sorte of new Set(liste.map((eintrag) => eintrag.sorte))) {
    if (!gruen && !pausiert.has(sorte)) pausiert.set(sorte, "der letzte CI-Lauf auf master ist nicht grün");
  }
  return { pausiert, befunde };
}
