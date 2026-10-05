import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FORMAT = 1;
export const BASIS = "basis";
export const BRANCH = "branch";
export const PLAN_ART = "plan";
export const MAX_PAKETE = 20;
const SHA = /^[0-9a-f]{40}$/;
const PRUEFSUMME = /^[0-9a-f]{64}$/;
const QUELLDATEI = /^src\/.+\.[cm]?js$/;
const TESTPFAD = /^test\/.+/;
const ORT_LAENGE = 2;
const STATUS = new Set([
  "Killed",
  "Survived",
  "NoCoverage",
  "CompileError",
  "RuntimeError",
  "Timeout",
  "Ignored",
  "Pending",
  "CheckFailed",
]);
const TIMEOUT = "Timeout";
const RANG_GETOETET = 2;
const RANG_ZEITUEBERSCHREITUNG = 1;
const RANG = new Map([
  ["Killed", RANG_GETOETET],
  [TIMEOUT, RANG_ZEITUEBERSCHREITUNG],
]);
const MAX_BESCHREIBUNG = 140;
const AUSLASSUNG = "…";

export function rang(status) {
  return RANG.get(status) ?? 0;
}

export function pruefsumme(text) {
  return createHash("sha256").update(text).digest("hex");
}

function istZahl(wert) {
  return Number.isFinite(wert) && wert >= 0;
}

function istSortierteListe(wert, muster) {
  if (!Array.isArray(wert) || !wert.every((eintrag) => typeof eintrag === "string")) return false;
  const sortiert = [...new Set(wert)].sort();
  return wert.every((eintrag, index) => eintrag === sortiert[index] && muster.test(eintrag));
}

function istMutantenListe(wert, dateien) {
  if (wert === null || typeof wert !== "object" || Array.isArray(wert)) return false;
  return Object.entries(wert).every(
    ([schluessel, status]) =>
      STATUS.has(status) && dateien.some((datei) => schluessel.startsWith(`${datei}:`)),
  );
}

function gleicheSha(wert, erwartet) {
  return typeof wert === "string" && SHA.test(wert) && wert === erwartet;
}

function gemeinsameFehler(daten, art, erwartet) {
  const dateien = Array.isArray(daten.dateien) ? daten.dateien : [];
  const mutantenGueltig =
    istMutantenListe(daten.mutanten, dateien) && istMutantenListe(daten.gate, dateien);
  const pruefungen = [
    [daten.format === FORMAT && daten.art === art, "Format oder Art passt nicht"],
    [gleicheSha(daten.kopf, erwartet.kopf), "Kopf-SHA passt nicht"],
    [gleicheSha(daten.master, erwartet.master), "master-SHA passt nicht"],
    [daten.bereich === erwartet.bereich, "Bereich passt nicht"],
    [istSortierteListe(daten.dateien, QUELLDATEI), "Dateiliste ist ungültig"],
    [mutantenGueltig, "Mutantenliste ist ungültig"],
    [istZahl(daten.trockenlauf?.sekunden), "Trockenlauf fehlt"],
  ];
  return pruefungen.filter(([gilt]) => !gilt).map(([, grund]) => grund);
}

function istObjekt(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

function istOrt(ort) {
  return (
    Array.isArray(ort) &&
    ort.length === ORT_LAENGE &&
    ort.every(Number.isInteger) &&
    ort[0] >= 1 &&
    ort[1] >= ort[0]
  );
}

function orteGueltig({ orte, mutanten, gate }) {
  if (!istObjekt(orte) || !istObjekt(mutanten) || !istObjekt(gate)) return false;
  const getoetet = [...Object.entries(mutanten), ...Object.entries(gate)].filter(
    ([, status]) => rang(status) > 0,
  );
  return getoetet.every(([schluessel]) => istOrt(orte[schluessel]));
}

function basisFehler(daten) {
  const dateien = new Set(Array.isArray(daten.dateien) ? daten.dateien : []);
  const teilmenge = (liste) =>
    istSortierteListe(liste, QUELLDATEI) && liste.every((datei) => dateien.has(datei));
  const pruefungen = [
    [
      teilmenge(daten.erreicht) && teilmenge(daten.erreichtGate),
      "Liste der erreichten Dateien ist ungültig",
    ],
    [istZahl(daten.testzeilen?.vorher) && istZahl(daten.testzeilen?.nachher), "Testzeilen fehlen"],
    [
      istSortierteListe(daten.tests?.alt, TESTPFAD) &&
        istSortierteListe(daten.tests?.neu, TESTPFAD),
      "Liste der geänderten Testdateien ist ungültig",
    ],
    [orteGueltig(daten), "Orte der getöteten Mutanten fehlen"],
  ];
  return pruefungen.filter(([gilt]) => !gilt).map(([, grund]) => grund);
}

function leseDatei(ordner, name) {
  let eintraege;
  try {
    eintraege = readdirSync(ordner);
  } catch {
    return { fehler: [`Artefakt ${name} fehlt`] };
  }
  if (eintraege.length !== 1 || eintraege[0] !== `${name}.json`) {
    return { fehler: [`Artefakt ${name} enthält nicht genau die Datei ${name}.json`] };
  }
  return { text: readFileSync(join(ordner, `${name}.json`), "utf8") };
}

function alsObjekt(text) {
  try {
    const wert = JSON.parse(text);
    return wert !== null && typeof wert === "object" && !Array.isArray(wert) ? wert : undefined;
  } catch {
    return undefined;
  }
}

export function pruefeArtefakt({ name, art, text, summe, erwartet }) {
  if (summe !== undefined && !PRUEFSUMME.test(summe ?? "")) {
    return { fehler: [`Für ${name} fehlt die Prüfsumme`] };
  }
  if (summe !== undefined && pruefsumme(text) !== summe) {
    return { fehler: [`Artefakt ${name} passt nicht zur Prüfsumme`] };
  }
  const daten = alsObjekt(text);
  if (daten === undefined) return { fehler: [`Artefakt ${name} ist kein JSON-Objekt`] };
  const schema = [
    ...gemeinsameFehler(daten, art, erwartet),
    ...(art === BASIS ? basisFehler(daten) : []),
  ];
  if (schema.length > 0) return { fehler: schema.map((grund) => `Artefakt ${name}: ${grund}`) };
  return { daten };
}

export function leseArtefakt({ ordner, name, art, summe, erwartet }) {
  const { text, fehler } = leseDatei(join(ordner, name), name);
  if (fehler) return { fehler };
  return pruefeArtefakt({ name, art, text, summe, erwartet });
}

function paketGueltig(paket) {
  return (
    istObjekt(paket) &&
    istZahl(paket.mutanten) &&
    istSortierteListe(paket.dateien, QUELLDATEI) &&
    paket.dateien.length > 0
  );
}

function planFehler(daten, erwartet) {
  const pakete = Array.isArray(daten.pakete) ? daten.pakete : [];
  const alle = pakete.flatMap((paket) => (Array.isArray(paket?.dateien) ? paket.dateien : []));
  const pruefungen = [
    [daten.format === FORMAT && daten.art === PLAN_ART, "Format oder Art passt nicht"],
    [gleicheSha(daten.kopf, erwartet.kopf), "Kopf-SHA passt nicht"],
    [gleicheSha(daten.master, erwartet.master), "master-SHA passt nicht"],
    [daten.bereich === erwartet.bereich, "Bereich passt nicht"],
    [
      pakete.length > 0 && pakete.length <= MAX_PAKETE && pakete.every(paketGueltig),
      "Paketliste ist ungültig",
    ],
    [new Set(alle).size === alle.length, "eine Datei steht in mehreren Paketen"],
    [
      istSortierteListe(daten.tests?.alt, TESTPFAD) &&
        istSortierteListe(daten.tests?.neu, TESTPFAD),
      "Liste der geänderten Testdateien ist ungültig",
    ],
  ];
  return pruefungen.filter(([gilt]) => !gilt).map(([, grund]) => `Plan: ${grund}`);
}

export function pruefePlan({ text, summe, erwartet }) {
  if (!PRUEFSUMME.test(summe ?? "")) return { fehler: ["Für den Plan fehlt die Prüfsumme"] };
  if (pruefsumme(text) !== summe) return { fehler: ["Der Plan passt nicht zur Prüfsumme"] };
  const daten = alsObjekt(text);
  if (daten === undefined) return { fehler: ["Der Plan ist kein JSON-Objekt"] };
  const fehler = planFehler(daten, erwartet);
  return fehler.length > 0 ? { fehler } : { daten };
}

export function lesePlan({ ordner, summe, erwartet }) {
  const { text, fehler } = leseDatei(join(ordner, PLAN_ART), PLAN_ART);
  if (fehler) return { fehler };
  return pruefePlan({ text, summe, erwartet });
}

export function vereinige(teile) {
  const liste = (feld) => [...new Set(teile.flatMap((teil) => teil[feld] ?? []))].sort();
  const objekt = (feld) => Object.assign({}, ...teile.map((teil) => teil[feld] ?? {}));
  return {
    ...teile[0],
    dateien: liste("dateien"),
    erreicht: liste("erreicht"),
    erreichtGate: liste("erreichtGate"),
    mutanten: objekt("mutanten"),
    gate: objekt("gate"),
    orte: objekt("orte"),
  };
}

function aufBranchGetoetet(branchStatus, basisStatus) {
  if (branchStatus === TIMEOUT) return basisStatus === TIMEOUT;
  return rang(branchStatus) > 0;
}

function datei(schluessel, dateien) {
  return dateien.find((kandidat) => schluessel.startsWith(`${kandidat}:`));
}

function vergleich(basis, branch, erreicht) {
  const getoetet = Object.keys(basis).filter((schluessel) => rang(basis[schluessel]) > 0);
  const verloren = getoetet.filter(
    (schluessel) => !aufBranchGetoetet(branch[schluessel], basis[schluessel]),
  );
  const imBranch = Object.keys(branch).filter((schluessel) => rang(branch[schluessel]) > 0);
  const dateien = [...erreicht.dateien];
  const unerreicht = imBranch.filter(
    (schluessel) => !erreicht.menge.has(datei(schluessel, dateien)),
  );
  const unbekannt = Object.keys(branch).filter((schluessel) => !Object.hasOwn(basis, schluessel));
  return {
    basis: getoetet.length,
    branch: getoetet.length - verloren.length,
    verloren,
    unerreicht,
    unbekannt,
  };
}

export function entscheide(basis, branch) {
  const alle = { dateien: basis.dateien };
  const mutanten = vergleich(basis.mutanten, branch.mutanten, {
    ...alle,
    menge: new Set(basis.erreicht),
  });
  const gate = vergleich(basis.gate, branch.gate, { ...alle, menge: new Set(basis.erreichtGate) });
  const verstoesse = [
    ...mutanten.verloren.map(
      (schluessel) => `Mutant auf dem Branch nicht mehr getötet: ${schluessel}`,
    ),
    ...gate.verloren.map((schluessel) => `Gate-Lauf: Mutant nicht mehr getötet: ${schluessel}`),
    ...[...mutanten.unerreicht, ...gate.unerreicht].map(
      (schluessel) =>
        `Als getötet gemeldet, aber keine Testdatei des Branches erreicht die Datei: ${schluessel}`,
    ),
    ...[...mutanten.unbekannt, ...gate.unbekannt].map(
      (schluessel) =>
        `Der Branch meldet einen Mutanten, den die Basis nicht gemessen hat: ${schluessel}`,
    ),
  ];
  return { gruen: verstoesse.length === 0, verstoesse, mutanten, gate };
}

export function beschreibung({ gruen, mutanten, gate }) {
  const text = `${gruen ? "grün" : "rot"}: getötet Basis ${mutanten.basis}, Branch ${mutanten.branch}; Gate ${gate.basis}/${gate.branch}; verloren ${mutanten.verloren.length + gate.verloren.length}, unerreicht ${mutanten.unerreicht.length + gate.unerreicht.length}`;
  return text.length <= MAX_BESCHREIBUNG
    ? text
    : `${text.slice(0, MAX_BESCHREIBUNG - 1)}${AUSLASSUNG}`;
}
