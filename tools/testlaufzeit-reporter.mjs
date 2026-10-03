import path from "node:path";

const ERGEBNISSE = new Set(["test:pass", "test:fail"]);
const DATEI_ENDE = "test:complete";
const NACHKOMMASTELLEN = 10;

function runde(ms) {
  return Math.round(ms * NACHKOMMASTELLEN) / NACHKOMMASTELLEN;
}

function eintragFuer(dateien, datei) {
  if (!dateien.has(datei)) dateien.set(datei, { dauer: null, kind: null, tests: 0 });
  return dateien.get(datei);
}

function istDateiEbene(daten) {
  return path.resolve(daten.name) === daten.file;
}

function verbuche(dateien, { type, data }) {
  if (!data?.file) return;
  const eintrag = eintragFuer(dateien, path.resolve(data.file));
  if (type === "test:summary") eintrag.kind = data.duration_ms;
  if (data.nesting !== 0 || typeof data.name !== "string") return;
  const dateiEbene = istDateiEbene(data);
  if (dateiEbene && type === DATEI_ENDE) eintrag.dauer = data.details.duration_ms;
  if (!dateiEbene && ERGEBNISSE.has(type)) eintrag.tests += data.details.duration_ms;
}

function zeile(datei, { dauer, kind, tests }) {
  return {
    datei: path.relative(process.cwd(), datei),
    dauer_ms: dauer === null ? null : runde(dauer),
    ausklingen_ms: kind === null ? null : runde(Math.max(0, kind - tests)),
  };
}

export default async function* testlaufzeitReporter(quelle) {
  const dateien = new Map();
  for await (const ereignis of quelle) verbuche(dateien, ereignis);
  for (const [datei, eintrag] of dateien) yield `${JSON.stringify(zeile(datei, eintrag))}\n`;
}
