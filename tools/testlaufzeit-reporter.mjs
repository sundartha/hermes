import path from "node:path";

const ERGEBNISSE = new Set(["test:pass", "test:fail"]);
const DATEI_ENDE = "test:complete";
const NACHKOMMASTELLEN = 10;

function runde(ms) {
  return Math.round(ms * NACHKOMMASTELLEN) / NACHKOMMASTELLEN;
}

function eintragFuer(dateien, datei) {
  if (!dateien.has(datei)) {
    dateien.set(datei, { dauer: null, kind: null, tests: 0, bestanden: false });
  }
  return dateien.get(datei);
}

function istDateiEbene(daten) {
  return path.resolve(daten.name) === daten.file;
}

function verbucheDateiEnde(eintrag, { details }) {
  Object.assign(eintrag, { dauer: details.duration_ms, bestanden: details.passed === true });
}

function verbuche(dateien, { type, data }) {
  if (!data?.file) return;
  const eintrag = eintragFuer(dateien, path.resolve(data.file));
  if (type === "test:summary") eintrag.kind = data.duration_ms;
  if (data.nesting !== 0 || typeof data.name !== "string") return;
  if (istDateiEbene(data)) {
    if (type === DATEI_ENDE) verbucheDateiEnde(eintrag, data);
  } else if (ERGEBNISSE.has(type)) {
    eintrag.tests += data.details.duration_ms;
  }
}

function zeile(datei, { dauer, kind, tests, bestanden }) {
  return {
    datei: path.relative(process.cwd(), datei),
    dauer_ms: dauer === null ? null : runde(dauer),
    ausklingen_ms: kind === null ? null : runde(Math.max(0, kind - tests)),
    tests_ms: runde(tests),
    kind_ms: kind === null ? null : runde(kind),
    bestanden,
  };
}

export default async function* testlaufzeitReporter(quelle) {
  const dateien = new Map();
  for await (const ereignis of quelle) verbuche(dateien, ereignis);
  for (const [datei, eintrag] of dateien) yield `${JSON.stringify(zeile(datei, eintrag))}\n`;
}
