import { existsSync } from "node:fs";
import { cwd } from "node:process";

import { geaenderteFaelle } from "../auftrag/faelle.mjs";
import { muster } from "../tests-ausmisten/ausnehmen.mjs";
import { ALTER_SCHUTZ, ALTER_SCHUTZ_BELEGT, ALTER_SCHUTZ_NICHT_BELEGT, satzNummer, SCHUTZFAELLE_MUSTER, SCHUTZ_NICHT_PRUEFBAR, SCHUTZ_UNERREICHT, SCHUTZ_WIRKSAM, SCHUTZ_WIRKUNGSLOS } from "../auftrag/schutzkennung.mjs";

const GETOETET = new Set(["Killed", "Timeout"]);
const GELAUFEN_UEBERLEBT = "Survived";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const VERSTOSS = "Verstoß: ";
const WIRKUNGSLOS = `${VERSTOSS}${SCHUTZ_WIRKUNGSLOS}`;
const NICHT_BELEGT = `${VERSTOSS}${ALTER_SCHUTZ_NICHT_BELEGT}`;

function schutzfaelle(basis, testdateien) {
  return testdateien
    .filter((pfad) => existsSync(pfad))
    .flatMap((pfad) => geaenderteFaelle(basis, cwd(), pfad).map((fall) => ({ ...fall, pfad })))
    .filter((fall) => fall.neu && !fall.still && satzNummer(fall.name, Infinity) !== null);
}

function genannt(grund, name) {
  return `${grund ?? ""}, `.includes(`: ${name}, `);
}

async function gemeinsamGetoetet(einheiten, faelle, werkzeug) {
  const wirksam = new Set();
  for (const pfad of new Set(faelle.map((fall) => fall.pfad))) {
    for (const { datei, bereiche } of einheiten) {
      const ergebnisse = await werkzeug.stryker({ datei, zeilen: bereiche, tests: [pfad], namensmuster: SCHUTZFAELLE_MUSTER });
      for (const fall of faelle.filter((eintrag) => eintrag.pfad === pfad)) {
        if (ergebnisse.some(({ status, grund }) => GETOETET.has(status) && genannt(grund, fall.name))) wirksam.add(fall);
      }
    }
  }
  return wirksam;
}

async function einzeln(fall, ziele, werkzeug) {
  let erreicht = false;
  for (const { datei, bereiche } of ziele) {
    const ergebnisse = await werkzeug.stryker({ datei, zeilen: bereiche, tests: [fall.pfad], namensmuster: muster(fall.name) });
    if (ergebnisse.some(({ status }) => GETOETET.has(status))) return SCHUTZ_WIRKSAM;
    erreicht ||= ergebnisse.some(({ status }) => status === GELAUFEN_UEBERLEBT);
  }
  return erreicht ? WIRKUNGSLOS : SCHUTZ_UNERREICHT;
}

function alteSchutzstellen(angaben) {
  const stellen = new Map();
  for (const angabe of angaben) {
    const [, kennung, datei, zeile] = ALTER_SCHUTZ.exec(angabe) ?? [];
    if (kennung === undefined) throw new Error("--alter-schutz hat nicht die Form [NIE1] src/DATEI:ZEILE");
    if (stellen.has(kennung)) throw new Error("--alter-schutz nennt dieselbe Kennung mehr als einmal");
    stellen.set(kennung, { datei, zeile: Number(zeile) });
  }
  return stellen;
}

function geaendert(einheiten, { datei, zeile }) {
  return einheiten.some((einheit) => einheit.datei === datei && einheit.bereiche.some(([von, bis]) => von <= zeile && zeile <= bis));
}

async function alterSchutz(fall, { einheiten, stellen }, werkzeug) {
  const stelle = stellen.get(fall.name.slice(0, fall.name.indexOf(" ")));
  if (stelle === undefined) return [`${WIRKUNGSLOS}: ${fall.name}`];
  const ort = `${stelle.datei}:${stelle.zeile}`;
  if (!existsSync(stelle.datei)) return [`${NICHT_BELEGT} (${ort} gibt es nicht): ${fall.name}`];
  if (geaendert(einheiten, stelle)) return [`${NICHT_BELEGT} (${ort} ist seit der Basis geändert): ${fall.name}`];
  const urteil = await einzeln(fall, [{ datei: stelle.datei, bereiche: [[stelle.zeile, stelle.zeile]] }], werkzeug);
  if (urteil === SCHUTZ_WIRKSAM) return [`${ALTER_SCHUTZ_BELEGT} (${ort}): ${fall.name}`];
  return [`${NICHT_BELEGT} (${ort}, der Fall tötet dort keinen Mutanten): ${fall.name}`];
}

async function urteile(faelle, kontext, werkzeug) {
  const wirksam = await gemeinsamGetoetet(kontext.einheiten, faelle, werkzeug);
  const zeilen = [];
  for (const fall of faelle) {
    const urteil = wirksam.has(fall) ? SCHUTZ_WIRKSAM : await einzeln(fall, kontext.einheiten, werkzeug);
    zeilen.push(...(urteil === WIRKUNGSLOS ? await alterSchutz(fall, kontext, werkzeug) : [`${urteil}: ${fall.name}`]));
  }
  return zeilen;
}

export async function schutzwirkungPruefung(basis, angaben, werkzeug) {
  const stellen = alteSchutzstellen(angaben);
  const faelle = schutzfaelle(basis, werkzeug.testdateien());
  const einheiten = (await werkzeug.einheiten()).filter(({ bereiche }) => bereiche !== undefined);
  if (faelle.length === 0 || einheiten.length === 0) {
    const grund = faelle.length === 0 ? "kein neuer Fall mit [NIE<n>]-Kennung" : "keine neue oder geänderte Zeile unter src/";
    console.log(`${SCHUTZ_NICHT_PRUEFBAR}, ${grund}.`);
    console.log("grün: keine Wirkung zu prüfen.");
    return EXIT_GRUEN;
  }
  await werkzeug.freigabe();
  const zeilen = await urteile(faelle, { einheiten, stellen }, werkzeug);
  for (const zeile of zeilen) console.log(zeile);
  const verstoesse = zeilen.filter((zeile) => zeile.startsWith(VERSTOSS)).length;
  console.log(`${verstoesse === 0 ? "grün" : "rot"}: ${faelle.length} Schutztests, ${verstoesse} ohne nachgewiesene Wirkung.`);
  return verstoesse === 0 ? EXIT_GRUEN : EXIT_ROT;
}
