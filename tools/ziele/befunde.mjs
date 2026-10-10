import { issuesMitLabel, kommentare, kommentiere, stelleLabelSicher } from "./github.mjs";

export const LABEL = "aufraeumen";
export const BOT_ACTIONS = "github-actions[bot]";
export const LABEL_TEXT = "Befund des nächtlichen Aufräumens (tools/ziele.mjs)";
export const WIEDER = "Wieder aufgetreten";
const BEFUND_TITEL = /^Aufräumen: (AR-[a-z-]+) in `([\w./@+-]+)`$/;
const SICHERE_DATEI = /^[\w./@+-]{1,300}$/;
const GESCHLOSSEN = { state: "closed", state_reason: "not_planned" };
export const IDS = {
  test: "AR-test",
  geschuetzt: "AR-geschuetzt",
  fremd: "AR-fremde-datei",
  geloescht: "AR-geloescht",
  lint: "AR-lint",
  neu: "AR-neue-befunde",
  offen: "AR-nicht-behoben",
  testsRot: "AR-tests-rot",
  mutation: "AR-mutation",
  prRot: "AR-pr-rot",
  prAnlage: "AR-pr-anlage",
  agent: "AR-agent",
  zeit: "AR-zeit",
  budget: "AR-budget",
  pause: "AR-pause-ohne-issue",
};
const FESTE_TEXTE = {
  [IDS.test]: "Der Lauf hat eine Testdatei geändert; die Prüfung hat den Patch verworfen.",
  [IDS.geschuetzt]: "Der Lauf hat eine geschützte Datei geändert; die Prüfung hat den Patch verworfen.",
  [IDS.fremd]: "Der Lauf hat eine andere Datei als das Ziel geändert; die Prüfung hat den Patch verworfen.",
  [IDS.geloescht]: "Der Lauf hat die Zieldatei gelöscht; ganze Dateien löscht das Aufräumen nie.",
  [IDS.lint]: "Nach der Änderung meldet ESLint Fehler in der Zieldatei.",
  [IDS.neu]: "Nach der Änderung melden knip oder jscpd neue Befunde.",
  [IDS.offen]: "Nach der Änderung stehen die Befunde der Sorte noch in der Zieldatei.",
  [IDS.testsRot]: "Nach der Änderung sind betroffene Tests rot.",
  [IDS.mutation]: "Nach der Änderung ist die Mutationsprüfung rot.",
  [IDS.prRot]: "Der eigene PR war rot und ist geschlossen.",
  [IDS.prAnlage]: "Die geprüfte Änderung ließ sich nicht als PR anlegen (Push, PR oder Auto-Merge gescheitert); die Datei bleibt bis zur nächsten Änderung gesperrt.",
  [IDS.agent]: "Der Agent ist ohne gültiges Ergebnis geendet.",
  [IDS.zeit]: "Der Agent hat seine Zeitgrenze überschritten.",
  [IDS.budget]: "Für den Agenten blieb im Budget keine Minute mehr.",
  [IDS.pause]: "Eine Rücknahme hat weder ein Reparatur- noch ein master-rot-Issue; die Sorte bleibt pausiert.",
};

export const ROTE_IDS = new Set([IDS.test, IDS.geschuetzt, IDS.fremd, IDS.geloescht, IDS.prAnlage]);

export function befund(id, datei, text) {
  return { id, datei, text };
}

export function befundTitel({ id, datei }) {
  return `Aufräumen: ${id} in \`${datei}\``;
}

export function gueltigeBefunde(befunde) {
  const bekannt = new Set(Object.values(IDS));
  const gueltig = befunde.filter(({ id, datei }) => bekannt.has(id) && SICHERE_DATEI.test(String(datei)));
  return gueltig.map(({ id, datei, betroffen }) => ({ id, datei, ...(SICHERE_DATEI.test(String(betroffen)) && { betroffen }) }));
}

function befundText({ id, datei, betroffen }, lauf) {
  const andere = betroffen ? [`- Geänderte andere Datei: \`${betroffen}\``] : [];
  return [`- Regel-ID: ${id}`, `- Zieldatei: \`${datei}\``, ...andere, `- Lauf: ${lauf}`, "", FESTE_TEXTE[id], ""].join("\n");
}

export function istVomBot(eintrag) {
  return eintrag.user?.login === BOT_ACTIONS;
}

export async function meldeIssue(github, { bestehend, titel, text, label, lauf, schliessen = false }) {
  const vorhanden = bestehend.find((issue) => issue.title === titel);
  if (vorhanden === undefined) {
    const neu = await github.sende("POST", "/issues", { title: titel, body: text, labels: [label] });
    if (schliessen) await github.sende("PATCH", `/issues/${neu.number}`, GESCHLOSSEN);
    bestehend.push(neu);
    return { nummer: neu.number, art: "neu" };
  }
  await kommentiere(github, vorhanden.number, `${WIEDER}: ${lauf}`);
  if (schliessen && vorhanden.state !== "closed") await github.sende("PATCH", `/issues/${vorhanden.number}`, GESCHLOSSEN);
  return { nummer: vorhanden.number, art: "kommentiert" };
}

export async function meldeBefunde(github, befunde, lauf) {
  const gueltig = gueltigeBefunde(befunde);
  if (gueltig.length === 0) return [];
  await stelleLabelSicher(github, LABEL, LABEL_TEXT);
  const bestehend = (await issuesMitLabel(github, LABEL)).filter(istVomBot);
  const gemeldet = [];
  const titel = [...new Map(gueltig.map((eintrag) => [befundTitel(eintrag), eintrag]))];
  for (const [kopf, eintrag] of titel) {
    const text = befundText(eintrag, lauf);
    gemeldet.push(await meldeIssue(github, { bestehend, titel: kopf, text, label: LABEL, lauf, schliessen: true }));
  }
  return gemeldet;
}

async function juengstesVorkommen(github, issue) {
  const zeiten = [issue.created_at];
  if (issue.comments > 0) {
    const liste = (await kommentare(github, issue.number)).filter(istVomBot);
    zeiten.push(...liste.filter(({ body }) => (body ?? "").startsWith(WIEDER)).map(({ created_at: zeit }) => zeit));
  }
  return Math.max(...zeiten.map((zeit) => Date.parse(zeit)).filter(Number.isFinite));
}

export async function befundZeiten(github) {
  const zeiten = new Map();
  for (const issue of (await issuesMitLabel(github, LABEL)).filter(istVomBot)) {
    const datei = BEFUND_TITEL.exec(issue.title ?? "")?.[2];
    if (datei === undefined) continue;
    const zeit = await juengstesVorkommen(github, issue);
    zeiten.set(datei, Math.max(zeiten.get(datei) ?? 0, zeit));
  }
  return zeiten;
}
