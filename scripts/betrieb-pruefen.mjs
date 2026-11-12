#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_ROT = 1;
const ARGV_OFFSET = 2;
const REGELN = "docs/betrieb/grafana/alarmregeln.json";
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

export function pruefeAlarme(wurzel) {
  const regeln = JSON.parse(fs.readFileSync(path.join(wurzel, REGELN), "utf8"));
  return regeln.flatMap((regel) => befundeFuer(wurzel, regel));
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
  const befunde = [
    ...pruefeAlarme(wurzel),
    ...(argv.includes("--panels") ? pruefePanels(wurzel) : []),
  ];
  for (const befund of befunde) console.error(befund);
  process.exit(befunde.length > 0 ? EXIT_ROT : 0);
}
