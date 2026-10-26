import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { pitchPfad } from "./annahmen.mjs";
import { auftragsCommits, gibtEsIn, git } from "./git.mjs";
import { istObjekt, istText, liste } from "./planung/erkundung.mjs";
import { teilVon } from "./planung/kopfzeile.mjs";
import { MASTER } from "./worktrees.mjs";

const KURZ_SHA = 7;
const ART = "Art: ";
const EIGENER_STAND = "HEAD";
const UMBAU = "umbau";
const SCHNITT = "planung/schnitt.json";
const ZWECK = `Ein Teil eines geteilten Pitches plant und baut erst auf einem Stand, der jeden Vorgänger aus „nach:“ in pitch.md enthält; sonst fehlt ihm Code, auf dem sein Auftrag steht. Gezählt wird nur ein gebauter Auftrag des Vorgängers (Zeilen „Auftrag:“ und „Art:“) auf ${MASTER}, der auch im eigenen Stand (${EIGENER_STAND}) gilt; nicht der eigene Branch allein, kein Plan-Commit und kein zurückgenommener Commit. Behebung: den Vorgänger bauen und mergen lassen; ist er schon gemergt, erst git fetch upstream master und den eigenen Stand auf ${MASTER} bringen.`;

function stand(root) {
  try {
    return git(["rev-parse", "--verify", "--quiet", MASTER], { cwd: root }).trim();
  } catch {
    return null;
  }
}

function gebauteCommits(root, bezug) {
  const gebaut = auftragsCommits(root, bezug).filter(({ trailer }) => [...trailer].some((zeile) => zeile.startsWith(ART)));
  return (passt) => gebaut.find(({ trailer }) => [...trailer].some(passt));
}

function gebauteTeile(root, bezug) {
  const finde = gebauteCommits(root, bezug);
  return (teil) => finde((zeile) => zeile.startsWith(`Auftrag: ${teil}/`));
}

function vorgaengerStaende(root, nach) {
  const gemergt = gebauteTeile(root, MASTER);
  const imStand = gebauteTeile(root, EIGENER_STAND);
  return nach.map((vorgaenger) => {
    const commit = gemergt(vorgaenger);
    const fehltImStand = imStand(vorgaenger) === undefined;
    return { vorgaenger, commit, fehltImStand, gilt: commit !== undefined && !fehltImStand };
  });
}

function fehlendeBefunde(teil, nach, root) {
  const sha = stand(root);
  if (sha === null) return [`Teil ${teil}: ${MASTER} fehlt; ohne den Hauptstand lässt sich nicht prüfen, ob ${nach.join(", ")} gemergt sind.`, ZWECK];
  const befunde = vorgaengerStaende(root, nach).flatMap(({ vorgaenger, commit, gilt }) => {
    if (gilt) return [];
    if (commit === undefined) return [`Teil ${teil}: Vorgänger ${vorgaenger} ist auf ${MASTER} (${sha.slice(0, KURZ_SHA)}) nicht gemergt; kein geltender Commit trägt „Auftrag: ${vorgaenger}/…“ mit „${ART}…“.`];
    return [`Teil ${teil}: Vorgänger ${vorgaenger} ist auf ${MASTER} (${sha.slice(0, KURZ_SHA)}) gemergt, fehlt aber im eigenen Stand (${EIGENER_STAND}); der Teil baut sonst ohne seinen Code.`];
  });
  return befunde.length > 0 ? [...befunde, ZWECK] : [];
}

export function vorgaengerBefunde(teil, nach, root) {
  return nach.length === 0 ? [] : fehlendeBefunde(teil, nach, root);
}

export function gemergteVorgaenger(root, nach) {
  if (nach.length === 0 || stand(root) === null) return [];
  return vorgaengerStaende(root, nach)
    .filter(({ gilt }) => gilt)
    .map(({ vorgaenger, commit }) => ({ vorgaenger, sha: commit.sha.slice(0, KURZ_SHA) }));
}

export function teilVorgaengerBefunde(phase, root) {
  const pitch = pitchPfad(phase);
  if (pitch === null || !existsSync(join(root, pitch))) return [];
  const herkunft = teilVon(readFileSync(join(root, pitch), "utf8"));
  if (herkunft === undefined) return [];
  if (herkunft.fehler !== undefined) return [`Teil ${phase.phase}: ${herkunft.fehler}`];
  return vorgaengerBefunde(phase.phase, herkunft.nach, root);
}

function schnittAufMaster(root, vorgaenger) {
  const pitch = pitchPfad({ phase: vorgaenger });
  if (pitch === null) return null;
  const pfad = posix.join(posix.dirname(pitch), SCHNITT);
  if (!gibtEsIn(MASTER, pfad, root)) return null;
  try {
    return JSON.parse(git(["show", `${MASTER}:${pfad}`], { cwd: root }));
  } catch {
    return null;
  }
}

function umbauAuftraege(root, vorgaenger) {
  const schnitt = schnittAufMaster(root, vorgaenger);
  return liste(schnitt?.auftraege).filter((auftrag) => istObjekt(auftrag) && auftrag.art === UMBAU && istText(auftrag.id));
}

function umgebauteFunktionen(auftrag) {
  return liste(auftrag.altfunktionen).filter((alt) => istObjekt(alt) && istText(alt.datei) && istText(alt.funktion));
}

export function gemergteUmbauten(root, nach) {
  if (nach.length === 0 || stand(root) === null) return [];
  const gemergt = gebauteCommits(root, MASTER);
  const imStand = gebauteCommits(root, EIGENER_STAND);
  return nach.flatMap((vorgaenger) =>
    umbauAuftraege(root, vorgaenger).flatMap((auftrag) => {
      const zeile = `Auftrag: ${vorgaenger}/${auftrag.id}`;
      const gleich = (trailer) => trailer === zeile;
      const commit = gemergt(gleich);
      if (commit === undefined || imStand(gleich) === undefined) return [];
      return umgebauteFunktionen(auftrag).map(({ datei, funktion }) => ({ vorgaenger, datei, funktion, sha: commit.sha.slice(0, KURZ_SHA) }));
    }),
  );
}
