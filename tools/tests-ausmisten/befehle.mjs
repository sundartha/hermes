import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { setzeAusgaben } from "../ziele/ausgabe.mjs";
import { paketName } from "./artefakte.mjs";
import {
  BASIS,
  BRANCH,
  FORMAT,
  PLAN_ART,
  leseArtefakt,
  lesePlan,
  pruefsumme,
  rang,
  verstoesseIn,
} from "./entscheiden.mjs";
import { pruefsummenZeile } from "./festgehalten.mjs";
import { ausloeser } from "./herkunft.mjs";
import { git, gitGelingt, leseBereiche, pfadVerstoesse, testaenderungen } from "./pfade.mjs";
import { vorpruefung } from "./vorpruefung.mjs";

const TESTBESTAND = ["--", "test/", ":(exclude)test/werkzeuge/"];
const ZEILENZAHL = /:(\d+)$/;
const ZAHLENSPALTE = /^(\d+)\t(\d+)\t/;
const EINRUECKUNG = 2;
const MS_JE_SEKUNDE = 1000;
const ISSUE_ZEILE = /^Issue: #(\d{1,9})$/m;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

function geprueft(herkunft) {
  const master = git(["rev-parse", "HEAD"]).trim();
  const stand = { von: master, bis: herkunft.kopf, verzeichnis: cwd() };
  if (!gitGelingt(["merge-base", "--is-ancestor", master, herkunft.kopf])) {
    throw new Error(
      "Der Branch liegt nicht auf dem aktuellen master; erst rebasen und neu pushen.",
    );
  }
  const verstoesse = [...pfadVerstoesse(stand), ...vorpruefung(stand)];
  if (verstoesse.length > 0) throw new Error(`Vorprüfung rot:\n${verstoesse.join("\n")}`);
  return { ...herkunft, master };
}

async function vorbereitet() {
  const bereiche = leseBereiche();
  const lauf = geprueft(await ausloeser({ bereiche }));
  const [messen, menge] = await Promise.all([import("./messen.mjs"), import("./messmenge.mjs")]);
  return { lauf, bereiche, werkzeug: { ...messen, ...menge }, beginn: Date.now() };
}

function testzeilen(master, kopf) {
  const zaehlung = git(["grep", "-c", "-I", "", master, ...TESTBESTAND]).split("\n");
  const vorher = zaehlung.reduce(
    (summe, zeile) => summe + Number(ZEILENZAHL.exec(zeile)?.[1] ?? 0),
    0,
  );
  const zahlen = git(["diff", "--numstat", "--no-renames", master, kopf, ...TESTBESTAND]).split(
    "\n",
  );
  const delta = zahlen.reduce((summe, zeile) => {
    const [, hinzu, weg] = ZAHLENSPALTE.exec(zeile) ?? [];
    return hinzu === undefined ? summe : summe + Number(hinzu) - Number(weg);
  }, 0);
  return { vorher, nachher: vorher + delta };
}

function erreichteDateien(dateien, { graph, gates }, werkzeug) {
  const tests = (datei) => werkzeug.erreichendeTests(datei, graph);
  return {
    erreicht: dateien.filter((datei) => tests(datei).length > 0),
    erreichtGate: dateien.filter((datei) => tests(datei).some((test) => gates.has(test))),
  };
}

function statusListe(stati) {
  return Object.fromEntries([...stati].map(([schluessel, { status }]) => [schluessel, status]));
}

function orteDerGetoeteten({ mutanten, gate }) {
  const getoetet = [...mutanten, ...gate].filter(([, { status }]) => rang(status) > 0);
  return Object.fromEntries(getoetet.map(([schluessel, { zeilen }]) => [schluessel, zeilen]));
}

function schreibeErgebnis(aus, name, daten) {
  rmSync(aus, { recursive: true, force: true });
  mkdirSync(aus, { recursive: true });
  const text = `${JSON.stringify(daten, null, EINRUECKUNG)}\n`;
  writeFileSync(join(aus, `${name}.json`), text);
  const summe = pruefsumme(text);
  setzeAusgaben({ pruefsumme: summe });
  return summe;
}

function kopfdaten({ lauf, beginn }, dateien) {
  return {
    format: FORMAT,
    kopf: lauf.kopf,
    master: lauf.master,
    bereich: lauf.bereich,
    dateien,
    sekunden: Math.round((Date.now() - beginn) / MS_JE_SEKUNDE),
  };
}

async function mengen({ lauf, bereiche, werkzeug }) {
  const graph = await werkzeug.importgraph();
  const branchSicht = await werkzeug.imStand(lauf.kopf, async () => ({
    graph: await werkzeug.importgraph(),
    gates: werkzeug.gateMenge(),
  }));
  const geaendert = testaenderungen(lauf.master, lauf.kopf);
  const alt = { rev: lauf.master, graph };
  const menge = werkzeug.messmenge({ bereich: lauf.bereich, bereiche, geaendert, alt });
  const unmessbar = werkzeug.mengenVerstoesse({ geaendert, alt, menge });
  if (unmessbar.length > 0) throw new Error(`Nicht messbar:\n${unmessbar.join("\n")}`);
  const neu = werkzeug.geaenderteTestdateien(geaendert, {
    rev: lauf.kopf,
    graph: branchSicht.graph,
  });
  console.log(
    `Bereich ${lauf.bereich}: ${menge.dateien.length} Dateien zum Mutieren, ${menge.alt.length} geänderte Testdateien auf master, ${neu.length} im Branch.`,
  );
  return { graph, branchSicht, menge, neu };
}

function issueDes(kopf) {
  const nachricht = git(["log", "-1", "--format=%B", kopf]);
  const treffer = ISSUE_ZEILE.exec(nachricht);
  return treffer === null ? null : Number(treffer[1]);
}

async function suche(quelle, { lauf, schluessel }) {
  const speicher = await import("./zwischenspeicher.mjs");
  if (quelle.speicher !== undefined)
    return schluessel.map(
      (wert) => speicher.ausSpeicher(quelle.speicher, { schluessel: wert, lauf }) ?? null,
    );
  if (!quelle.token) return schluessel.map(() => null);
  const github = githubZugang({ token: quelle.token });
  return speicher.ausFrueherenLaeufen(github, { lauf, laufId: env.GITHUB_RUN_ID, schluessel });
}

async function fruehereBasis(quelle, { lauf, pakete, alt }) {
  const { basisSchluessel } = await import("./zwischenspeicher.mjs");
  const schluessel = pakete.map(({ dateien }) =>
    basisSchluessel({ master: lauf.master, dateien, alt }),
  );
  let frueher;
  try {
    frueher = await suche(quelle, { lauf, schluessel });
  } catch (grund) {
    console.log(
      `Frühere Basis: Suche nicht möglich (${grund.message}); alle Pakete werden gemessen.`,
    );
    return pakete.map(() => null);
  }
  frueher.forEach((eintrag, nummer) => {
    if (eintrag !== null)
      console.log(
        `Frühere Basis für Paket ${nummer}: ${eintrag.artefakt} aus Lauf ${eintrag.lauf}.`,
      );
  });
  return frueher;
}

export async function planen({ aus, speicher }) {
  const vorbereitung = await vorbereitet();
  const { lauf } = vorbereitung;
  const { menge, neu } = await mengen(vorbereitung);
  const { zaehle, packe } = await import("./planen.mjs");
  const zahlen = await zaehle(menge.dateien);
  const pakete = packe(zahlen);
  const geschaetzt = zahlen.reduce((summe, { mutanten }) => summe + mutanten, 0);
  console.log(`${geschaetzt} Mutanten geschätzt, ${pakete.length} Pakete.`);
  const quelle = { speicher, token: env.GITHUB_TOKEN };
  const frueher = await fruehereBasis(quelle, { lauf, pakete, alt: menge.alt });
  schreibeErgebnis(aus, PLAN_ART, {
    ...kopfdaten(vorbereitung, menge.dateien),
    art: PLAN_ART,
    tests: { alt: menge.alt, neu },
    issue: issueDes(lauf.kopf),
    pakete,
    frueher,
    geschaetzt: zahlen,
  });
  setzeAusgaben({ pakete: JSON.stringify(pakete.map((_paket, index) => index)) });
  return lauf;
}

function geplant(ordner, lauf) {
  const erwartet = { kopf: lauf.kopf, master: lauf.master, bereich: lauf.bereich };
  const { daten, fehler } = lesePlan({ ordner, summe: env.PLAN_PRUEFSUMME, erwartet });
  if (fehler) throw new Error(`Plan unbrauchbar: ${fehler.join("; ")}`);
  return daten;
}

function paketDes(plan, paket) {
  const nummer = Number(paket);
  if (!Number.isInteger(nummer) || nummer < 0 || nummer >= plan.pakete.length) {
    throw new Error(`Paket ${paket} steht nicht im Plan.`);
  }
  return { nummer, dateien: plan.pakete[nummer].dateien };
}

async function messwerte(werkzeug, { dateien, alt }) {
  const gates = werkzeug.gateMenge();
  const vorlauf = await werkzeug.trockenlauf(alt);
  const gateAlt = alt.filter((test) => gates.has(test));
  const gemessen = await werkzeug.messeGegenAlte({ dateien, alt, gateAlt });
  return {
    mutanten: statusListe(gemessen.mutanten),
    gate: statusListe(gemessen.gate),
    orte: orteDerGetoeteten(gemessen),
    trockenlauf: vorlauf,
    jeDatei: gemessen.jeDatei,
    wiederverwendet: null,
  };
}

function wiederverwendbar(plan, { nummer, schluessel }) {
  const eintrag = plan.frueher[nummer];
  if (eintrag === null || eintrag.schluessel !== schluessel) return undefined;
  console.log(
    `Basis für Paket ${nummer} wiederverwendet: ${eintrag.artefakt} aus Lauf ${eintrag.lauf}.`,
  );
  const { lauf, artefakt, mutanten, gate, orte, trockenlauf, jeDatei } = eintrag;
  return { mutanten, gate, orte, trockenlauf, jeDatei, wiederverwendet: { lauf, artefakt } };
}

export async function basis({ aus, planDaten, paket }) {
  const vorbereitung = await vorbereitet();
  const { lauf, werkzeug } = vorbereitung;
  const plan = geplant(planDaten, lauf);
  const { nummer, dateien } = paketDes(plan, paket);
  const branchSicht = await werkzeug.imStand(lauf.kopf, async () => ({
    graph: await werkzeug.importgraph(),
    gates: werkzeug.gateMenge(),
  }));
  const { alt, neu } = plan.tests;
  const { basisSchluessel } = await import("./zwischenspeicher.mjs");
  const schluessel = basisSchluessel({ master: lauf.master, dateien, alt });
  const werte =
    wiederverwendbar(plan, { nummer, schluessel }) ?? (await messwerte(werkzeug, { dateien, alt }));
  const summe = schreibeErgebnis(aus, paketName(BASIS, nummer), {
    ...kopfdaten(vorbereitung, dateien),
    art: BASIS,
    paket: nummer,
    tests: { alt, neu },
    ...werte,
    ...erreichteDateien(dateien, branchSicht, werkzeug),
    testzeilen: testzeilen(lauf.master, lauf.kopf),
    schluessel,
  });
  console.log(pruefsummenZeile(nummer, summe));
}

function basisArtefakt(ordner, { lauf, nummer }) {
  const erwartet = { kopf: lauf.kopf, master: lauf.master, bereich: lauf.bereich };
  const name = paketName(BASIS, nummer);
  const { daten, fehler } = leseArtefakt({
    ordner,
    name,
    art: BASIS,
    summe: env.BASIS_PRUEFSUMME ?? "",
    erwartet,
  });
  if (fehler) throw new Error(`Basis-Artefakt unbrauchbar: ${fehler.join("; ")}`);
  const karte = (liste) =>
    new Map(
      Object.entries(liste).map(([schluessel, status]) => [
        schluessel,
        { status, zeilen: daten.orte[schluessel] },
      ]),
    );
  return { daten, getoetet: { mutanten: karte(daten.mutanten), gate: karte(daten.gate) } };
}

function legeBranchDarueber({ master, kopf }) {
  const diff = git(["diff", "--binary", "--no-renames", master, kopf, ...TESTBESTAND]);
  if (diff !== "") git(["apply", "--index", "--whitespace=nowarn", "-"], cwd(), diff);
}

function abbruchBeiVerstoss(daten, verstoesse) {
  return (datei, ergebnis) => {
    const branch = { mutanten: statusListe(ergebnis.mutanten), gate: statusListe(ergebnis.gate) };
    verstoesse.push(...verstoesseIn([datei], daten, branch));
    return verstoesse.length > 0;
  };
}

function meldeAbbruch(nummer, { dateien, gemessen, verstoesse }) {
  if (verstoesse.length === 0) return EXIT_GRUEN;
  for (const verstoss of verstoesse) console.log(`Verstoß: ${verstoss}`);
  const offen = dateien.length - gemessen.length;
  console.log(
    `Paket ${nummer}: rot nach ${gemessen.at(-1)}; ${offen} weitere Dateien nicht mehr gemessen.`,
  );
  return EXIT_ROT;
}

export async function branch({ aus, planDaten, basisDaten, paket }) {
  const vorbereitung = await vorbereitet();
  const { lauf, werkzeug } = vorbereitung;
  const { nummer, dateien } = paketDes(geplant(planDaten, lauf), paket);
  const { daten, getoetet } = basisArtefakt(basisDaten, { lauf, nummer });
  if (daten.dateien.join("\n") !== dateien.join("\n"))
    throw new Error("Basis-Artefakt passt nicht zum Paket.");
  legeBranchDarueber(lauf);
  const graph = await werkzeug.importgraph();
  const vorlauf = await werkzeug.trockenlauf(daten.tests.neu);
  const verstoesse = [];
  const gemessen = await werkzeug.messeGegenNeue({
    dateien,
    basis: getoetet,
    neu: daten.tests.neu,
    graph,
    gates: werkzeug.gateMenge(),
    nachDatei: abbruchBeiVerstoss(daten, verstoesse),
  });
  schreibeErgebnis(aus, paketName(BRANCH, nummer), {
    ...kopfdaten(vorbereitung, dateien),
    art: BRANCH,
    paket: nummer,
    gemessen: gemessen.gemessen,
    mutanten: statusListe(gemessen.mutanten),
    gate: statusListe(gemessen.gate),
    trockenlauf: vorlauf,
    jeDatei: gemessen.jeDatei,
  });
  return meldeAbbruch(nummer, { dateien, gemessen: gemessen.gemessen, verstoesse });
}
