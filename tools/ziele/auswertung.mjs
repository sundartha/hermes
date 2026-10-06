import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SYSTEM_LABEL, aeltestesSystemIssue } from "../auftrag/system.mjs";
import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";
import { ersetzeSteuerzeichen } from "../auftrag/pruefer-schema.mjs";
import { MIN_AGENT_SEKUNDEN, agentBefehl, budgetFehlt, budgetMinuten, istWartend, nimmToken, restSekunden, starteAgent } from "./agent.mjs";
import {
  BLOCKIERT,
  GEAENDERT,
  SAUBER,
  WEITER,
  ergebnisVon,
  laufAdresse,
  leseJson,
  schreibeJson,
  setzeAusgaben,
  zusammenfassung,
} from "./ausgabe.mjs";
import { WIEDER, istVomBot, meldeIssue } from "./befunde.mjs";
import { issuesMitLabel, kommentare, kommentiere, letzterBearbeitenderLauf, nimmGithubZugang, stelleLabelSicher } from "./github.mjs";
import { masterSha } from "./vorpruefen.mjs";
import { fuehreAus } from "./werkzeuge.mjs";

export const WORKFLOW = "auswertung.yml";
const ARBEITSSCHRITT = "Zählen";
const ZAEHL_ORDNER = "zaehlung";
const ZAEHL_DATEI = "zaehlung.json";
const VORSCHLAG_ORDNER = "vorschlag";
const VORSCHLAG_DATEI = "vorschlag.json";
const ISSUE_ORDNER = "issue";
const ISSUE_DATEI = "issue.json";
const BUDGET_NAME = "Auswertung";
const PROMPT = "tools/ziele/auswertung-agent.md";
const WOCHE_MS = 604_800_000;
const ZEITABLAUF = "Zeitablauf";
const RESERVE_ISSUE_SEKUNDEN = 60;
const MAX_DATEIEN = 10;
const MAX_PFAD = 200;
const MAX_ROTPROBE = 600;
const MAX_BEGRUENDUNG = 1200;
const MAX_ADRESSEN = 20;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
export const MECHANISMEN = ["typ", "lint-regel", "pruefskript", "test", "konfiguration"];
const SICHERER_PFAD = /^[\w./@-]+$/;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mechanismus", "dateien", "rotprobe", "begruendung"],
  properties: {
    mechanismus: { type: "string", enum: MECHANISMEN },
    dateien: { type: "array", maxItems: MAX_DATEIEN, items: { type: "string", maxLength: MAX_PFAD } },
    rotprobe: { type: "string", maxLength: MAX_ROTPROBE },
    begruendung: { type: "string", maxLength: MAX_BEGRUENDUNG },
  },
};
const KATALOG_ID = /^(?:[A-Z]\d{1,2}|SG-\d{2,3})$/;
const AUFRAEUMEN_ID = /^AR-[a-z-]+$/;
const ERLEDIGT = "completed";
const KENNUNG = {
  pruefer: (issue) => /^Prüfer: (\S+) in /.exec(issue.title)?.[1],
  aufraeumen: (issue) => /^Aufräumen: (\S+) in /.exec(issue.title)?.[1],
  wackelig: () => "wackelig",
  reparatur: () => "reparatur",
  "master-rot": () => "master-rot",
};
const GUELTIG = {
  pruefer: (kennung) => KATALOG_ID.test(kennung),
  aufraeumen: (kennung) => AUFRAEUMEN_ID.test(kennung),
  wackelig: () => true,
  reparatur: () => true,
  "master-rot": () => true,
};

export function systemTitel(kennung) {
  return `System: ${kennung}`;
}

async function vorkommenDes(github, issue, kennung) {
  const eigene = [{ kennung, zeit: issue.created_at, nummer: issue.number }];
  if (!(issue.comments > 0)) return eigene;
  const vomBot = (await kommentare(github, issue.number)).filter(istVomBot);
  const wieder = vomBot.filter(({ body }) => (body ?? "").startsWith("Wieder"));
  return [...eigene, ...wieder.map(({ created_at: zeit }) => ({ kennung, zeit, nummer: issue.number }))];
}

export async function vorkommen(github) {
  const liste = [];
  for (const [label, kennungVon] of Object.entries(KENNUNG)) {
    for (const issue of (await issuesMitLabel(github, label)).filter(istVomBot)) {
      const kennung = kennungVon(issue);
      if (kennung && GUELTIG[label](kennung)) liste.push(...(await vorkommenDes(github, issue, kennung)));
    }
  }
  return liste;
}

function verdichtet([kennung, eintraege]) {
  const zeiten = eintraege.map(({ zeit }) => Date.parse(zeit));
  zeiten.sort((links, rechts) => links - rechts);
  const nummern = [...new Set(eintraege.map(({ nummer }) => nummer))].sort((links, rechts) => links - rechts);
  return { kennung, anzahl: eintraege.length, erstes: zeiten[0], letztes: zeiten.at(-1), nummern };
}

export function wiederkehrende(liste, seit) {
  const jeKennung = [...Map.groupBy(liste, ({ kennung }) => kennung)].map(verdichtet);
  const wieder = jeKennung.filter(({ anzahl, letztes }) => anzahl > 1 && letztes > seit);
  return wieder.sort((links, rechts) => rechts.anzahl - links.anzahl || links.erstes - rechts.erstes);
}

function planeIssues(liste, systemIssues, jetzt) {
  const nachTitel = new Map(systemIssues.map((issue) => [issue.title, issue]));
  const wiederOeffnen = liste
    .map((eintrag) => ({ eintrag, issue: nachTitel.get(systemTitel(eintrag.kennung)) }))
    .filter(({ eintrag, issue }) => issue?.state_reason === ERLEDIGT && eintrag.letztes > Date.parse(issue.closed_at))
    .map(({ eintrag, issue }) => ({ nummer: issue.number, kennung: eintrag.kennung }));
  const kandidat = liste.find(({ kennung }) => !nachTitel.has(systemTitel(kennung))) ?? null;
  const dieseWoche = systemIssues.some(({ created_at: erstellt }) => jetzt - Date.parse(erstellt) < WOCHE_MS);
  return { wiederOeffnen, kandidat: dieseWoche ? null : kandidat, gesperrt: dieseWoche && kandidat !== null };
}

function ausPlan(plan) {
  if (plan.kandidat !== null || plan.wiederOeffnen.length > 0) {
    const { nummern = [] } = plan.kandidat ?? {};
    const kandidat = plan.kandidat && { ...plan.kandidat, nummern: nummern.slice(0, MAX_ADRESSEN) };
    return { ...ergebnisVon(WEITER, ""), kandidat, wiederOeffnen: plan.wiederOeffnen };
  }
  if (plan.gesperrt) return { ...ergebnisVon(SAUBER, "höchstens ein system-Issue je Woche"), wiederOeffnen: [] };
  return { ...ergebnisVon(SAUBER, "alle wiederkehrenden Befunde haben ein system-Issue"), wiederOeffnen: [] };
}

export async function zaehle({ github, root, jetzt }) {
  const master = masterSha(root);
  const basis = { master, start: new Date(jetzt).toISOString() };
  const letzter = await letzterBearbeitenderLauf(github, { workflow: WORKFLOW, schritt: ARBEITSSCHRITT });
  if (letzter?.head_sha === master) return { ...ergebnisVon(SAUBER, `master unverändert seit ${letzter.html_url ?? letzter.id}`), ...basis };
  const seit = Date.parse(letzter?.run_started_at ?? "") || 0;
  const liste = wiederkehrende(await vorkommen(github), seit);
  if (liste.length === 0) return { ...ergebnisVon(SAUBER, "kein wiederkehrender Befund"), ...basis };
  const systemIssues = (await issuesMitLabel(github, SYSTEM_LABEL)).filter(istVomBot);
  return { ...ausPlan(planeIssues(liste, systemIssues, jetzt)), ...basis };
}

export async function zaehlen({ ordner }, root, { github = nimmGithubZugang() } = {}) {
  const ergebnis = await zaehle({ github, root, jetzt: Date.now() });
  schreibeJson(join(ordner, ZAEHL_ORDNER), ZAEHL_DATEI, ergebnis);
  setzeAusgaben({ ausgang: ergebnis.ausgang, grund: ergebnis.grund, agent: ergebnis.kandidat ? "ja" : "nein" });
  console.log(`Zählung: ${ergebnis.ausgang}${ergebnis.kandidat ? `, Kandidat ${ergebnis.kandidat.kennung} (${ergebnis.kandidat.anzahl} Vorkommen)` : ""}${ergebnis.grund ? ` (${ergebnis.grund})` : ""}`);
  return EXIT_GRUEN;
}

function sauber(text, laenge) {
  return ersetzeSteuerzeichen(String(text), " ").replaceAll("`", "'").slice(0, laenge);
}

function istObjekt(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

function gueltigeDateien(dateien) {
  if (!Array.isArray(dateien) || dateien.length > MAX_DATEIEN) return false;
  return dateien.every((datei) => typeof datei === "string" && SICHERER_PFAD.test(datei) && datei.length <= MAX_PFAD);
}

function gueltigeFelder(wert) {
  const felder = Object.keys(SCHEMA.properties);
  const nurBekannte = Object.keys(wert).every((feld) => felder.includes(feld));
  const texte = typeof wert.rotprobe === "string" && typeof wert.begruendung === "string";
  return nurBekannte && texte && MECHANISMEN.includes(wert.mechanismus) && gueltigeDateien(wert.dateien);
}

export function gueltigerVorschlag(wert) {
  if (!istObjekt(wert) || !gueltigeFelder(wert)) return null;
  const { mechanismus, dateien, rotprobe, begruendung } = wert;
  return { mechanismus, dateien, rotprobe: sauber(rotprobe, MAX_ROTPROBE), begruendung: sauber(begruendung, MAX_BEGRUENDUNG) };
}

function vorschlagsAuftrag(kandidat) {
  const nummern = kandidat.nummern.map((nummer) => `#${nummer}`);
  return [
    `Wiederkehrende Befund-ID: ${kandidat.kennung}`,
    `Vorkommen: ${kandidat.anzahl}`,
    `Issues: ${nummern.join(", ")}`,
    "Schlage den stärksten Mechanismus vor und antworte mit dem JSON nach dem Schema.",
    "",
  ].join("\n");
}

const ARCHIV = "stand.tar";
const OHNE = [":(exclude,glob)**/.claude/**", ":(exclude,glob)**/CLAUDE.md"];

async function imArchiv(root, ausfuehren) {
  const ordner = mkdtempSync(join(tmpdir(), "ziele-auswertung-"));
  const archiv = join(ordner, ARCHIV);
  const stand = join(ordner, "stand");
  try {
    gitAusgabe(["archive", "--format=tar", "-o", archiv, "HEAD", "--", ".", ...OHNE], root);
    mkdirSync(stand);
    const entpackt = fuehreAus(["tar", "-xf", archiv, "-C", stand], ordner);
    if (entpackt.status !== 0) throw new Error(`tar ist mit Exit ${entpackt.status} gescheitert`);
    rmSync(archiv);
    return await ausfuehren(stand);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

async function vorschlagsLauf(root, { zaehlung, token }) {
  const minuten = budgetMinuten(root, BUDGET_NAME);
  if (minuten === null) return { grund: budgetFehlt(BUDGET_NAME), tokens: 0, zuege: 0 };
  const sekunden = restSekunden(minuten, { start: zaehlung.start, jetzt: Date.now(), reserve: RESERVE_ISSUE_SEKUNDEN });
  if (sekunden < MIN_AGENT_SEKUNDEN) return { grund: `nur noch ${sekunden} s im Budget`, wartend: true, tokens: 0, zuege: 0 };
  const befehl = agentBefehl({ werkzeuge: "Read,Grep,Glob", erlaubt: [], modell: "opus", schema: SCHEMA, prompt: PROMPT });
  return imArchiv(root, (stand) =>
    starteAgent({ root: stand, befehl, eingabe: vorschlagsAuftrag(zaehlung.kandidat), sekunden, token, pruefeAntwort: gueltigerVorschlag }),
  );
}

function vorschlagsErgebnis(lauf) {
  const zaehler = { tokens: lauf.tokens, zuege: lauf.zuege };
  if (!lauf.grund) return { ergebnis: { ...ergebnisVon(WEITER, ""), ...zaehler, vorschlag: lauf.antwort }, rot: false };
  const wartend = istWartend(lauf.grund) || lauf.grund === ZEITABLAUF || lauf.wartend === true;
  return { ergebnis: { ...ergebnisVon(BLOCKIERT, `Agent: ${lauf.grund}`), ...zaehler }, rot: !wartend };
}

export async function vorschlagen({ ordner }, root) {
  const token = nimmToken();
  const zaehlung = leseJson(join(ordner, ZAEHL_ORDNER), ZAEHL_DATEI);
  if (!zaehlung?.kandidat) throw new Error("es gibt keinen Kandidaten für einen Vorschlag");
  const lauf = await vorschlagsLauf(root, { zaehlung, token });
  const { ergebnis, rot } = vorschlagsErgebnis(lauf);
  schreibeJson(join(ordner, VORSCHLAG_ORDNER), VORSCHLAG_DATEI, ergebnis);
  setzeAusgaben({ ausgang: ergebnis.ausgang, grund: ergebnis.grund });
  console.log(`Vorschlag: ${ergebnis.ausgang}${ergebnis.grund ? ` (${ergebnis.grund})` : ""}, Tokens ${ergebnis.tokens}, Züge ${ergebnis.zuege}`);
  return rot ? EXIT_ROT : EXIT_GRUEN;
}

export function systemText(kandidat, vorschlag, lauf) {
  const dateien = vorschlag.dateien.map((datei) => `\`${datei}\``);
  const vorkommen = kandidat.nummern.map((nummer) => `- #${nummer}`);
  return [
    `Die Befund-ID \`${kandidat.kennung}\` ist ${kandidat.anzahl}-mal aufgetreten.`,
    "",
    `- Mechanismus: ${vorschlag.mechanismus}`,
    `- Dateien: ${dateien.join(", ") || "keine genannt"}`,
    "",
    "Rot-Probe:",
    "",
    `> ${vorschlag.rotprobe}`,
    "",
    "Begründung:",
    "",
    `> ${vorschlag.begruendung}`,
    "",
    "Vorkommen:",
    ...vorkommen,
    "",
    "Umsetzung wie ein Paket; Mechanismen in geschützten Dateien brauchen ein Approve.",
    "",
    `Lauf: ${lauf}`,
    "",
  ].join("\n");
}

export async function schreibeSystemIssues({ github, zaehlung, vorschlag, lauf }) {
  for (const { nummer } of zaehlung.wiederOeffnen) {
    await github.sende("PATCH", `/issues/${nummer}`, { state: "open" });
    await kommentiere(github, nummer, `${WIEDER}: kommt trotz Mechanismus wieder (${lauf}).`);
  }
  if (!zaehlung.kandidat || vorschlag?.ausgang !== WEITER) return null;
  await stelleLabelSicher(github, SYSTEM_LABEL, "Auftrag für einen Mechanismus gegen einen wiederkehrenden Befund");
  const bestehend = (await issuesMitLabel(github, SYSTEM_LABEL)).filter(istVomBot);
  const titel = systemTitel(zaehlung.kandidat.kennung);
  const text = systemText(zaehlung.kandidat, vorschlag.vorschlag, lauf);
  return meldeIssue(github, { bestehend, titel, text, label: SYSTEM_LABEL, lauf });
}

function issueErgebnis(angelegt, { zaehlung, vorschlag }) {
  if (angelegt !== null || zaehlung.wiederOeffnen.length > 0) {
    return { ...ergebnisVon(GEAENDERT, ""), issue: angelegt?.nummer ?? null };
  }
  const grund = vorschlag?.grund || "kein gültiger Vorschlag";
  return { ...ergebnisVon(BLOCKIERT, grund), issue: null };
}

function issueZeilen(angelegt, aeltestes) {
  const neu = angelegt ? `System-Issue #${angelegt.nummer} (${angelegt.art})` : "kein neues system-Issue";
  const alt = aeltestes ? `Ältestes offenes system-Issue: #${aeltestes.number} ${aeltestes.title}` : "kein offenes system-Issue";
  return [neu, alt];
}

export async function systemIssue({ ordner }, root, { github = nimmGithubZugang() } = {}) {
  const zaehlung = leseJson(join(ordner, ZAEHL_ORDNER), ZAEHL_DATEI);
  if (zaehlung?.ausgang !== WEITER) throw new Error("die Zählung hat nichts zu schreiben");
  const vorschlag = leseJson(join(ordner, VORSCHLAG_ORDNER), VORSCHLAG_DATEI);
  const angelegt = await schreibeSystemIssues({ github, zaehlung, vorschlag, lauf: laufAdresse() });
  schreibeJson(join(ordner, ISSUE_ORDNER), ISSUE_DATEI, issueErgebnis(angelegt, { zaehlung, vorschlag }));
  zusammenfassung(issueZeilen(angelegt, await aeltestesSystemIssue(github)));
  return EXIT_GRUEN;
}
