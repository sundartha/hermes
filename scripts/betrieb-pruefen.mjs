#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_ROT = 1;
const ARGV_OFFSET = 2;
const REGELN = "docs/betrieb/grafana/alarmregeln.json";
const ANRUFREGELN = "docs/betrieb/grafana/anrufregeln.json";
const BETRIEBSREGELN = "docs/betrieb/grafana/betriebsregeln.json";
const BEZEICHNER = /[A-Za-z_:][A-Za-z0-9_:]*(?![A-Za-z0-9_:]|\s*\()/g;
const NACHKOMMA = 6;
const DASHBOARD = "docs/betrieb/grafana/dashboard.json";
const QUELLEN = ["src/utils/telemetrie.js", "src/utils/betriebsmessung.js"];
const SEITEN = "docs/betrieb/alarme";
const ABSCHNITTE = ["Symptom", "Prüfen", "Beheben", "Eskalieren"];

function parseWurzel(argv) {
  const stelle = argv.indexOf("--wurzel");
  if (stelle === -1) return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return path.resolve(argv[stelle + 1]);
}

function befundeFuer(wurzel, regel) {
  const erwartet = `${SEITEN}/${regel.uid}.md`;
  if (regel.annotations?.runbook_url !== erwartet) {
    return [`${regel.uid}: runbook_url muss ${erwartet} sein`];
  }
  const datei = path.join(wurzel, erwartet);
  if (!fs.existsSync(datei)) return [`${regel.uid}: Seite ${erwartet} fehlt`];
  const zeilen = fs.readFileSync(datei, "utf8").split("\n");
  return ABSCHNITTE.filter((name) => !zeilen.includes(`## ${name}`)).map(
    (name) => `${regel.uid}: Abschnitt "## ${name}" fehlt in ${erwartet}`,
  );
}

const GESTARTET = "hermes_call_started_total";

function optionaleRegeln(wurzel, name) {
  const datei = path.join(wurzel, name);
  return fs.existsSync(datei) ? JSON.parse(fs.readFileSync(datei, "utf8")) : [];
}

function anrufRegeln(wurzel) {
  return optionaleRegeln(wurzel, ANRUFREGELN);
}

function fehlerquote(burnrate, fenster) {
  const gesamt = `sum(increase(${burnrate.gesamt}[${fenster}]))`;
  const teil = burnrate.fehler
    ? `sum(increase(${burnrate.fehler}[${fenster}]))`
    : `(${gesamt} - sum(increase(${burnrate.gut}[${fenster}])))`;
  return `${teil} / ${gesamt}`;
}

function schwelle(burnrate, faktor) {
  return Number((faktor * (1 - burnrate.slo)).toFixed(NACHKOMMA));
}

export function burnrateAusdruck(burnrate) {
  const paare = burnrate.fenster.map(([lang, kurz, faktor]) => {
    const grenze = schwelle(burnrate, faktor);
    const menge = `sum(increase(${burnrate.menge ?? GESTARTET}[${lang}])) >= ${burnrate.mindestAnrufe}`;
    return `(${fehlerquote(burnrate, lang)} > ${grenze} and ${fehlerquote(burnrate, kurz)} > ${grenze} and ${menge})`;
  });
  return paare.join(" or ");
}

function regelModell(regel, refId) {
  return regel.data.find((zeile) => zeile.refId === refId).model;
}

function regelAusdruck(regel) {
  return regelModell(regel, "A").expr;
}

function ausdruckBefund(regel) {
  const befunde = [];
  if (regelAusdruck(regel) !== burnrateAusdruck(regel.burnrate)) {
    befunde.push(`${regel.uid}: expr weicht von burnrate ab`);
  }
  if (regel.noDataState !== "OK") befunde.push(`${regel.uid}: noDataState muss OK sein`);
  return befunde;
}

function sollBefund(regel) {
  const { evaluator } = regelModell(regel, "C").conditions[0];
  const ist = [evaluator.type, evaluator.params[0], regel.for, regel.noDataState];
  const soll = [regel.soll?.vergleich, regel.soll?.wert, regel.soll?.dauer, regel.soll?.ohneDaten];
  const gleich = soll.every((wert, stelle) => wert !== undefined && wert === ist[stelle]);
  return gleich ? [] : [`${regel.uid}: Schwelle, Dauer oder noDataState weicht von soll ab`];
}

function kennzahlBefunde(regel, namen) {
  const woerter = regelAusdruck(regel).match(BEZEICHNER) ?? [];
  const genannt = woerter.filter((wort) => wort.includes("_"));
  if (genannt.length === 0) return [`${regel.uid}: expr nennt keine Kennzahl`];
  return genannt
    .filter((wort) => !namen.some((name) => deckt(wort, name)))
    .map((wort) => `${regel.uid}: Kennzahl ${wort} gibt es nicht`);
}

function betriebBefunde(wurzel) {
  return optionaleRegeln(wurzel, BETRIEBSREGELN).flatMap((regel) => [
    ...befundeFuer(wurzel, regel),
    ...sollBefund(regel),
    ...kennzahlBefunde(regel, kennzahlNamen(wurzel)),
  ]);
}

export function pruefeAlarme(wurzel) {
  const regeln = JSON.parse(fs.readFileSync(path.join(wurzel, REGELN), "utf8"));
  const anruf = anrufRegeln(wurzel);
  return [
    ...regeln.flatMap((regel) => befundeFuer(wurzel, regel)),
    ...anruf.flatMap((regel) => [...befundeFuer(wurzel, regel), ...ausdruckBefund(regel)]),
    ...betriebBefunde(wurzel),
  ];
}

function ausgeloest(regel, fenster) {
  const burnrate = regel.burnrate;
  const paar = burnrate.fenster.find(([lang, kurz, faktor]) => {
    const grenze = schwelle(burnrate, faktor);
    return (
      fenster[lang].quote > grenze &&
      fenster[kurz].quote > grenze &&
      fenster[lang].anrufe >= burnrate.mindestAnrufe
    );
  });
  return paar ? [{ uid: regel.uid, fenster: `${paar[0]}+${paar[1]}` }] : [];
}

export function probeAnrufregeln(wurzel, daten) {
  return anrufRegeln(wurzel).flatMap((regel) =>
    daten[regel.uid] ? ausgeloest(regel, daten[regel.uid]) : [],
  );
}

function kennzahlNamen(wurzel) {
  const namen = QUELLEN.flatMap((quelle) => {
    const text = fs.readFileSync(path.join(wurzel, quelle), "utf8");
    return [...text.matchAll(/"(hermes\.[a-z0-9_.]+)"/g)].map((treffer) => treffer[1]);
  });
  return [...new Set(namen)];
}

const TOKEN_ZEICHEN = /[A-Za-z0-9_:]/;
const SUFFIXE = ["_bucket", "_sum", "_count", "_total"];

function endetAlsToken(rest) {
  if (rest === "" || "{[) ".includes(rest[0])) return true;
  return SUFFIXE.some(
    (suffix) => rest.startsWith(suffix) && !TOKEN_ZEICHEN.test(rest[suffix.length] ?? ""),
  );
}

function deckt(ausdruck, name) {
  const metrik = name.replaceAll(".", "_");
  let von = ausdruck.indexOf(metrik);
  while (von !== -1) {
    const davor = von === 0 ? "" : ausdruck[von - 1];
    if (!TOKEN_ZEICHEN.test(davor) && endetAlsToken(ausdruck.slice(von + metrik.length)))
      return true;
    von = ausdruck.indexOf(metrik, von + 1);
  }
  return false;
}

export function pruefePanels(wurzel) {
  const datei = path.join(wurzel, DASHBOARD);
  if (!fs.existsSync(datei)) return [`${DASHBOARD} fehlt`];
  const namen = kennzahlNamen(wurzel);
  if (namen.length === 0) return ["keine Kennzahlen in den Quellen gefunden"];
  const ausdruecke = JSON.parse(fs.readFileSync(datei, "utf8")).panels.flatMap((panel) =>
    panel.targets.map((ziel) => ziel.expr),
  );
  return namen
    .filter((name) => !ausdruecke.some((ausdruck) => deckt(ausdruck, name)))
    .map((name) => `${name}: kein Panel in ${DASHBOARD}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(ARGV_OFFSET);
  const wurzel = parseWurzel(argv);
  const probe = argv.indexOf("--probe");
  if (probe !== -1) {
    console.log(JSON.stringify(probeAnrufregeln(wurzel, JSON.parse(argv[probe + 1]))));
    process.exit(0);
  }
  if (argv.includes("--regeln")) {
    const ausgabe = anrufRegeln(wurzel).map((regel) => ({
      uid: regel.uid,
      noDataState: regel.noDataState,
      expr: regelAusdruck(regel),
    }));
    console.log(JSON.stringify(ausgabe));
    process.exit(0);
  }
  const befunde = [
    ...pruefeAlarme(wurzel),
    ...(argv.includes("--panels") ? pruefePanels(wurzel) : []),
  ];
  for (const befund of befunde) console.error(befund);
  process.exit(befunde.length > 0 ? EXIT_ROT : 0);
}
