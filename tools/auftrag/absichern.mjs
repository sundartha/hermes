import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "node:process";

import { abhaengigkeitsgraph, vermesse } from "./abhaengigkeitsgraph.mjs";
import { absicherungsLauf, trailerZeile, vorabHerkunft } from "./absicherungsbeleg.mjs";
import { EXIT_GRUEN, EXIT_ROT, gueltigePhase } from "./befehle.mjs";
import { pruefeNachricht } from "./commitlint.mjs";
import { reihenfolge } from "./format.mjs";
import { dateiAm, git, hartZuruecksetzen, vormerken } from "./git.mjs";
import { auftragsKontext, gebauteAuftraege, neuerAuftragsLauf } from "./lauf.mjs";
import { vorabAbsichern } from "./mutation.mjs";
import { MASTER, legeAbsicherungAn } from "./worktrees.mjs";

const IN_CI = "HERMES_MUTATION_IN_CI";
const PLAETZE = "HERMES_MUTATION_PLAETZE";
const HOECHSTE_PLAETZE = 12;
const KLEINSTE_PLAETZE = 1;
const LAUF_ZEILE = /Lauf https:\/\/\S+\/actions\/runs\/(\d+)/;
const ERSTE_ZEILE = 1;
const KEIN_FEHLER = 0;
const STAND = "HEAD";
const EINZELN = 1;

export function absicherbare(phase, root) {
  const fertig = gebauteAuftraege(phase, root);
  const offen = reihenfolge(phase.auftraege).ordnung.filter(({ id }) => !fertig.has(id));
  const [laufend, ...wartend] = offen;
  if (laufend === undefined) return [];
  const graph = abhaengigkeitsgraph(offen, (datei) => dateiAm(STAND, datei, root));
  return wartend.filter((auftrag) => auftrag.art === "umbau" && auftrag.betrifft !== undefined && auftrag.abnahme !== laufend.abnahme && !graph.get(auftrag.id).has(laufend.id));
}

function teilenName(auftrag, anderer) {
  return Object.entries(auftrag.betrifft).some(([datei, namen]) => (anderer.betrifft[datei] ?? []).some((name) => namen.includes(name)));
}

function gruppiere(liste) {
  const gruppen = liste.reduce((bisher, auftrag) => {
    const verbunden = bisher.filter((gruppe) => gruppe.some((mitglied) => teilenName(mitglied, auftrag)));
    return [...bisher.filter((gruppe) => !verbunden.includes(gruppe)), [...verbunden.flat(), auftrag]];
  }, []);
  return gruppen.map((gruppe) => gruppe.toSorted((links, rechts) => liste.indexOf(links) - liste.indexOf(rechts))).toSorted((links, rechts) => liste.indexOf(links[0]) - liste.indexOf(rechts[0]));
}

function vereint(gruppe) {
  const betrifft = {};
  for (const auftrag of gruppe) for (const [datei, namen] of Object.entries(auftrag.betrifft)) betrifft[datei] = [...new Set([...(betrifft[datei] ?? []), ...namen])];
  return { ...gruppe[0], betrifft };
}

function ohneZeilen(text, bereiche) {
  const weg = new Set(bereiche.flatMap(([von, bis]) => Array.from({ length: bis - von + ERSTE_ZEILE }, (leer, index) => von + index)));
  return text
    .split("\n")
    .filter((zeile, index) => !weg.has(index + ERSTE_ZEILE))
    .join("\n");
}

function wegwerfStand(root, auftrag) {
  const aenderungen = Object.entries(auftrag.betrifft).map(([datei, namen]) => {
    const text = dateiAm(STAND, datei, root);
    const messung = text === null ? null : vermesse(text, namen);
    return messung === null ? null : { datei, text: ohneZeilen(text, messung.bereiche) };
  });
  if (aenderungen.some((aenderung) => aenderung === null)) return false;
  for (const { datei, text } of aenderungen) writeFileSync(join(root, datei), text);
  vormerken(aenderungen.map(({ datei }) => datei), root);
  return true;
}

function begrenztePlaetze(wert) {
  const zahl = Number(wert);
  return String(Number.isInteger(zahl) && zahl >= KLEINSTE_PLAETZE && zahl <= HOECHSTE_PLAETZE ? zahl : HOECHSTE_PLAETZE);
}

function nurId(auftrag) {
  return auftrag.id;
}

function vermerkText(gruppe) {
  const namen = gruppe.map(nurId).join(", ");
  if (gruppe.length === EINZELN) return { kopf: `Sichere Auftrag ${namen} vorab ab`, warum: `Warum: Die Mutationsprüfung am alten Stand ist für Auftrag ${namen} vorab grün; der Auftrag darf sie nur mit diesem Beleg weglassen.` };
  return { kopf: `Sichere ${gruppe.length} Aufträge vorab ab`, warum: `Warum: Die Mutationsprüfung am alten Stand ist für die Aufträge ${namen} in einem Lauf vorab grün; jeder darf sie nur mit diesem Beleg weglassen.` };
}

function vermerkt({ root, phase }, gruppe, nummer) {
  const { kopf, warum } = vermerkText(gruppe);
  const trailer = gruppe.map((auftrag) => trailerZeile(nummer, auftrag.id));
  const nachricht = [kopf, "", warum, "", ...trailer, vorabHerkunft(phase, gruppe[0]), ""].join("\n");
  const geprueft = pruefeNachricht(nachricht, root);
  if (geprueft.exitCode !== KEIN_FEHLER) return `Commitnachricht abgelehnt: ${geprueft.ausgabe}`;
  const commit = spawnSync("git", ["commit", "-q", "--allow-empty", "-F", "-"], { cwd: root, encoding: "utf8", input: nachricht });
  return commit.status === KEIN_FEHLER ? null : `git commit endete mit Exit ${commit.status}: ${commit.stderr.trim()}`;
}

function gebaut(ort, gruppe) {
  const { root, phase, phasendatei } = ort;
  const auftrag = vereint(gruppe);
  hartZuruecksetzen(STAND, root);
  if (!wegwerfStand(root, auftrag)) return { grund: "die Zeilen aus betrifft sind nicht vermessbar" };
  const lauf = neuerAuftragsLauf({ ...auftragsKontext(phase, auftrag, root), phasendatei, runde: 1, vorgeschichte: "" });
  const ergebnis = vorabAbsichern(lauf);
  if (!ergebnis.gruen) return { grund: lauf.grund ?? "die Mutationsprüfung am alten Stand ist nicht grün" };
  if (ergebnis.gleichwertig.length > 0) return { grund: `Gleichwertig gemeldet (${ergebnis.gleichwertig.length}); das prüft der Auftrag selbst` };
  const nummer = LAUF_ZEILE.exec(ergebnis.ausgabe)?.[1];
  if (nummer === undefined) return { grund: "die Ausgabe nennt keinen CI-Lauf" };
  hartZuruecksetzen(STAND, root);
  const abgelehnt = vermerkt(ort, gruppe, nummer);
  return abgelehnt === null ? { nummer } : { grund: abgelehnt };
}

function schonVermerkt(root, auftrag) {
  return absicherungsLauf(git(["log", "--format=%B", `${MASTER}..HEAD`], { cwd: root }), auftrag.id);
}

function meldeErgebnis(auftrag, { nummer, grund }) {
  console.log(nummer === undefined ? `Absicherung ${auftrag.id}: nicht abgesichert, ${grund}.` : `Absicherung ${auftrag.id}: abgesichert, Lauf ${nummer}.`);
}

function bearbeite(ort, gruppe) {
  const offen = gruppe.filter((auftrag) => schonVermerkt(ort.root, auftrag) === null);
  for (const auftrag of gruppe.filter((mitglied) => !offen.includes(mitglied))) console.log(`Absicherung ${auftrag.id}: schon abgesichert, Lauf ${schonVermerkt(ort.root, auftrag)}.`);
  if (offen.length === 0) return;
  const ergebnis = gebaut(ort, offen);
  for (const auftrag of offen) meldeErgebnis(auftrag, ergebnis);
}

export function absichern(phasendatei, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  for (const befund of befunde) console.error(befund);
  if (befunde.length > 0) return EXIT_ROT;
  const liste = absicherbare(phase, root);
  const namen = liste.map(nurId).join(", ");
  console.log(`Absicherung: ${liste.length} Aufträge ohne Verbindung zum laufenden${liste.length > 0 ? `: ${namen}` : ""}.`);
  if (liste.length === 0) return EXIT_GRUEN;
  env[IN_CI] = "1";
  env[PLAETZE] = begrenztePlaetze(env[PLAETZE]);
  const wt = legeAbsicherungAn(root, phase);
  const ort = { root: wt, phase, phasendatei: resolve(root, phasendatei) };
  for (const gruppe of gruppiere(liste)) bearbeite(ort, gruppe);
  return EXIT_GRUEN;
}
