import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";
import { stricterCases } from "../freigabe-strenger.mjs";
import { AGENT_DATEI, AGENT_ORDNER, AGENT_PATCH } from "./agentenlauf.mjs";
import { BLOCKIERT, WEITER, ergebnisVon, leseJson, schreibeJson, setzeAusgaben } from "./ausgabe.mjs";
import { IDS, ROTE_IDS, befund } from "./befunde.mjs";
import { FIXER_PATCH } from "./fixer.mjs";
import { commitNachricht } from "./nachricht.mjs";
import { geaenderteGegen, wendeAn } from "./patch.mjs";
import { BOT, BOT_EMAIL } from "./prs.mjs";
import { SCHUTZ, istTestPfad, schutzGrund, schutzLage } from "./schutz.mjs";
import { BASIS, BASIS_WERKZEUGE, basisVergleich, befundeDer } from "./sorten.mjs";
import { ORDNER } from "./vorpruefen.mjs";
import { DATEI as ZIEL } from "./waehlen.mjs";
import { eslintBefehl, fuehreAus } from "./werkzeuge.mjs";

export const PRUEF_ORDNER = "pruefung";
export const PRUEF_DATEI = "pruefung.json";
const GEAENDERT = "M";
const GELOESCHT = "D";
const MAX_AUSZUG = 20;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

export function committeAlsBot(root, nachricht) {
  gitAusgabe(["-c", `user.name=${BOT}`, "-c", `user.email=${BOT_EMAIL}`, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-F", "-"], root, { eingabe: nachricht });
}

function restText(rest, sorte) {
  const texte = rest.map((eintrag) => eintrag.text).join("; ");
  return ["Noch", rest.length, "Befunde von", sorte + ":", texte].join(" ");
}

function auszug(text) {
  const zeilen = text.split("\n").filter((zeile) => zeile.trim() !== "");
  return zeilen.slice(0, MAX_AUSZUG).join("\n");
}

function verstossAn(id, ziel, { path, status }) {
  return { ...befund(id, ziel.datei, `Geänderte Datei: ${path} (${status}).`), betroffen: path };
}

export function dateiVerstoss(aenderungen, ziel, schutz) {
  const datei = ziel.datei;
  if (aenderungen.length === 0) return befund(IDS.offen, datei, "Der Lauf hat keine Datei geändert.");
  const test = aenderungen.find(({ path }) => istTestPfad(path));
  if (test) return verstossAn(IDS.test, ziel, test);
  const geschuetzt = aenderungen
    .filter(({ path }) => ziel.sorte !== BASIS || path !== datei)
    .find(({ path }) => ![null, SCHUTZ.paket].includes(schutzGrund(path, schutz)));
  if (geschuetzt) return verstossAn(IDS.geschuetzt, ziel, geschuetzt);
  const fremd = aenderungen.find(({ path }) => path !== datei);
  if (fremd) return verstossAn(IDS.fremd, ziel, fremd);
  const [eigene] = aenderungen;
  if (eigene.status === GELOESCHT) return verstossAn(IDS.geloescht, ziel, eigene);
  return eigene.status === GEAENDERT ? null : verstossAn(IDS.fremd, ziel, eigene);
}

function basisVerstoss(root, ziel, aenderungen) {
  if (stricterCases(ziel.master, aenderungen) === undefined) {
    return befund(IDS.geschuetzt, ziel.datei, `${ziel.datei} wird nicht nur gekürzt.`);
  }
  const vergleiche = BASIS_WERKZEUGE.map((werkzeug) => basisVergleich(werkzeug, root));
  const rot = vergleiche.find(({ gruen }) => !gruen);
  if (rot) return befund(IDS.neu, ziel.datei, auszug(rot.ausgabe));
  const offen = vergleiche.find(({ datei, behoben }) => datei === ziel.datei && behoben.length > 0);
  return offen ? befund(IDS.offen, ziel.datei, `${offen.behoben.length} behobene Einträge stehen noch in ${ziel.datei}.`) : null;
}

function npmPruefung(root, { ziel, id }, argumente) {
  const lauf = fuehreAus(["npm", "run", "--silent", ...argumente], root);
  return lauf.status === EXIT_GRUEN ? null : befund(id, ziel.datei, auszug(`${argumente[0]}: ${lauf.stdout}${lauf.stderr}`));
}

const CODE_PRUEFUNGEN = [
  (root, ziel) => {
    if (!existsSync(join(root, ziel.datei))) return null;
    const lauf = fuehreAus(eslintBefehl([ziel.datei]), root);
    return lauf.status === EXIT_GRUEN ? null : befund(IDS.lint, ziel.datei, auszug(`${lauf.stdout}${lauf.stderr}`));
  },
  (root, ziel) => {
    const rot = BASIS_WERKZEUGE.map((werkzeug) => basisVergleich(werkzeug, root)).find(({ gruen }) => !gruen);
    return rot ? befund(IDS.neu, ziel.datei, auszug(rot.ausgabe)) : null;
  },
  (root, ziel) => {
    const rest = befundeDer(ziel.sorte, root).get(ziel.datei) ?? [];
    return rest.length === 0 ? null : befund(IDS.offen, ziel.datei, restText(rest, ziel.sorte));
  },
  (root, ziel) => {
    if (!Array.isArray(ziel.tests) || ziel.tests.length === 0) return befund(IDS.testsRot, ziel.datei, "Kein Test erreicht die Zieldatei.");
    return npmPruefung(root, { ziel, id: IDS.testsRot }, ["test", "--", ...ziel.tests]);
  },
  (root, ziel) => npmPruefung(root, { ziel, id: IDS.mutation }, ["test:mutation", "--", "--basis", ziel.master]),
];

export async function pruefeAenderung({ root, ziel, patch, zeitpunkt }) {
  wendeAn(root, patch);
  committeAlsBot(root, commitNachricht(ziel, zeitpunkt));
  const aenderungen = geaenderteGegen(root, ziel.master);
  const verstoss = dateiVerstoss(aenderungen, ziel, await schutzLage(root));
  if (verstoss) return { verstoss, aenderungen };
  if (ziel.sorte === BASIS) return { verstoss: basisVerstoss(root, ziel, aenderungen), aenderungen };
  for (const pruefung of CODE_PRUEFUNGEN) {
    const gefunden = pruefung(root, ziel);
    if (gefunden) return { verstoss: gefunden, aenderungen };
  }
  return { verstoss: null, aenderungen };
}

export function gewaehlterPatch(ordner) {
  const agent = leseJson(join(ordner, AGENT_ORDNER), AGENT_DATEI);
  if (agent === null) return join(ordner, ORDNER, FIXER_PATCH);
  if (agent.ausgang !== WEITER) throw new Error("der Agent hat keinen Patch geliefert");
  return join(ordner, AGENT_ORDNER, AGENT_PATCH);
}

export async function befehl({ ordner }, root) {
  const ziel = leseJson(join(ordner, ORDNER), ZIEL);
  if (ziel?.ausgang !== WEITER) throw new Error("es gibt kein Ziel zum Prüfen");
  if (typeof ziel.agent !== "boolean") throw new Error("der Fixer hat nicht abgeschlossen; ohne sein Ergebnis wird nichts geprüft");
  const ausgabe = join(ordner, PRUEF_ORDNER);
  mkdirSync(ausgabe, { recursive: true });
  const { verstoss, aenderungen } = await pruefeAenderung({ root, ziel, patch: gewaehlterPatch(ordner), zeitpunkt: new Date() });
  const dateien = aenderungen.map(({ status, path }) => `${status} ${path}`);
  if (verstoss) {
    schreibeJson(ausgabe, PRUEF_DATEI, { ...ergebnisVon(BLOCKIERT, `Verstoß ${verstoss.id}`), befunde: [verstoss], dateien });
    setzeAusgaben({ ausgang: BLOCKIERT, grund: `Verstoß ${verstoss.id}` });
    console.error(`Prüfung: Verstoß ${verstoss.id} in ${verstoss.datei}: ${verstoss.text}`);
    return ROTE_IDS.has(verstoss.id) ? EXIT_ROT : EXIT_GRUEN;
  }
  schreibeJson(ausgabe, PRUEF_DATEI, { ...ergebnisVon(WEITER, ""), dateien });
  setzeAusgaben({ ausgang: WEITER, grund: "" });
  console.log(`Prüfung: bestanden (${dateien.join(", ")})`);
  return EXIT_GRUEN;
}
