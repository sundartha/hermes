#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_ROT = 1;
const ARGV_OFFSET = 2;
const REGELN = "docs/betrieb/grafana/alarmregeln.json";
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const befunde = pruefeAlarme(parseWurzel(process.argv.slice(ARGV_OFFSET)));
  for (const befund of befunde) console.error(befund);
  process.exit(befunde.length > 0 ? EXIT_ROT : 0);
}
