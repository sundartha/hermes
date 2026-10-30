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
const STANDARD_PLAETZE = "12";
const LAUF_ZEILE = /Lauf https:\/\/\S+\/actions\/runs\/(\d+)/;
const ERSTE_ZEILE = 1;
const KEIN_FEHLER = 0;
const STAND = "HEAD";

export function absicherbare(phase, root) {
  const fertig = gebauteAuftraege(phase, root);
  const offen = reihenfolge(phase.auftraege).ordnung.filter(({ id }) => !fertig.has(id));
  const [laufend, ...wartend] = offen;
  if (laufend === undefined) return [];
  const graph = abhaengigkeitsgraph(offen, (datei) => dateiAm(STAND, datei, root));
  return wartend.filter((auftrag) => auftrag.art === "umbau" && auftrag.betrifft !== undefined && auftrag.abnahme !== laufend.abnahme && !graph.get(auftrag.id).has(laufend.id));
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

function nurId(auftrag) {
  return auftrag.id;
}

function vermerkt({ root, phase }, auftrag, nummer) {
  const warum = `Warum: Die Mutationsprüfung am alten Stand ist für Auftrag ${auftrag.id} vorab grün; der Auftrag darf sie nur mit diesem Beleg weglassen.`;
  const nachricht = [`Sichere Auftrag ${auftrag.id} vorab ab`, "", warum, "", trailerZeile(nummer, auftrag.id), vorabHerkunft(phase, auftrag), ""].join("\n");
  const geprueft = pruefeNachricht(nachricht, root);
  if (geprueft.exitCode !== KEIN_FEHLER) return `Commitnachricht abgelehnt: ${geprueft.ausgabe}`;
  const commit = spawnSync("git", ["commit", "-q", "--allow-empty", "-F", "-"], { cwd: root, encoding: "utf8", input: nachricht });
  return commit.status === KEIN_FEHLER ? null : `git commit endete mit Exit ${commit.status}: ${commit.stderr.trim()}`;
}

function gebaut(ort, auftrag) {
  const { root, phase, phasendatei } = ort;
  hartZuruecksetzen(STAND, root);
  if (!wegwerfStand(root, auftrag)) return { grund: "die Zeilen aus betrifft sind nicht vermessbar" };
  const lauf = neuerAuftragsLauf({ ...auftragsKontext(phase, auftrag, root), phasendatei, runde: 1, vorgeschichte: "" });
  const ergebnis = vorabAbsichern(lauf);
  if (!ergebnis.gruen) return { grund: lauf.grund ?? "die Mutationsprüfung am alten Stand ist nicht grün" };
  if (ergebnis.gleichwertig.length > 0) return { grund: `Gleichwertig gemeldet (${ergebnis.gleichwertig.length}); das prüft der Auftrag selbst` };
  const nummer = LAUF_ZEILE.exec(ergebnis.ausgabe)?.[1];
  if (nummer === undefined) return { grund: "die Ausgabe nennt keinen CI-Lauf" };
  hartZuruecksetzen(STAND, root);
  const abgelehnt = vermerkt(ort, auftrag, nummer);
  return abgelehnt === null ? { nummer } : { grund: abgelehnt };
}

function schonVermerkt(root, auftrag) {
  return absicherungsLauf(git(["log", "--format=%B", `${MASTER}..HEAD`], { cwd: root }), auftrag.id);
}

function bearbeite(ort, auftrag) {
  const vorhanden = schonVermerkt(ort.root, auftrag);
  if (vorhanden !== null) return console.log(`Absicherung ${auftrag.id}: schon abgesichert, Lauf ${vorhanden}.`);
  const { nummer, grund } = gebaut(ort, auftrag);
  return console.log(nummer === undefined ? `Absicherung ${auftrag.id}: nicht abgesichert, ${grund}.` : `Absicherung ${auftrag.id}: abgesichert, Lauf ${nummer}.`);
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
  env[PLAETZE] ??= STANDARD_PLAETZE;
  const wt = legeAbsicherungAn(root, phase);
  const ort = { root: wt, phase, phasendatei: resolve(root, phasendatei) };
  for (const auftrag of liste) bearbeite(ort, auftrag);
  return EXIT_GRUEN;
}
