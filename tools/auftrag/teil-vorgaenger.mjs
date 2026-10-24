import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { pitchPfad } from "./annahmen.mjs";
import { auftragsTrailer, git } from "./git.mjs";
import { teilVon } from "./planung/kopfzeile.mjs";
import { MASTER } from "./worktrees.mjs";

const KURZ_SHA = 7;
const ART = "Art: ";
const EIGENER_STAND = "HEAD";
const ZWECK = `Ein Teil eines geteilten Pitches plant und baut erst auf einem Stand, der jeden Vorgänger aus „nach:“ in pitch.md enthält; sonst fehlt ihm Code, auf dem sein Auftrag steht. Gezählt wird nur ein gebauter Auftrag des Vorgängers (Zeilen „Auftrag:“ und „Art:“) auf ${MASTER}, der auch im eigenen Stand (${EIGENER_STAND}) gilt; nicht der eigene Branch allein, kein Plan-Commit und kein zurückgenommener Commit. Behebung: den Vorgänger bauen und mergen lassen; ist er schon gemergt, erst git fetch upstream master und den eigenen Stand auf ${MASTER} bringen.`;

function stand(root) {
  try {
    return git(["rev-parse", "--verify", "--quiet", MASTER], { cwd: root }).trim();
  } catch {
    return null;
  }
}

function trailerGebauterCommits(trailer) {
  const zeilen = [...trailer];
  return zeilen.some((zeile) => zeile.startsWith(ART)) ? zeilen : [];
}

function gebauteTeile(root, bezug) {
  const auftraege = auftragsTrailer(root, bezug).flatMap(trailerGebauterCommits);
  return (teil) => auftraege.some((zeile) => zeile.startsWith(`Auftrag: ${teil}/`));
}

function fehlendeBefunde(teil, nach, root) {
  const sha = stand(root);
  if (sha === null) return [`Teil ${teil}: ${MASTER} fehlt; ohne den Hauptstand lässt sich nicht prüfen, ob ${nach.join(", ")} gemergt sind.`, ZWECK];
  const gemergt = gebauteTeile(root, MASTER);
  const imStand = gebauteTeile(root, EIGENER_STAND);
  const befunde = nach.flatMap((vorgaenger) => {
    if (!gemergt(vorgaenger)) return [`Teil ${teil}: Vorgänger ${vorgaenger} ist auf ${MASTER} (${sha.slice(0, KURZ_SHA)}) nicht gemergt; kein geltender Commit trägt „Auftrag: ${vorgaenger}/…“ mit „${ART}…“.`];
    return imStand(vorgaenger) ? [] : [`Teil ${teil}: Vorgänger ${vorgaenger} ist auf ${MASTER} (${sha.slice(0, KURZ_SHA)}) gemergt, fehlt aber im eigenen Stand (${EIGENER_STAND}); der Teil baut sonst ohne seinen Code.`];
  });
  return befunde.length > 0 ? [...befunde, ZWECK] : [];
}

export function vorgaengerBefunde(teil, nach, root) {
  return nach.length === 0 ? [] : fehlendeBefunde(teil, nach, root);
}

export function teilVorgaengerBefunde(phase, root) {
  const pitch = pitchPfad(phase);
  if (pitch === null || !existsSync(join(root, pitch))) return [];
  const herkunft = teilVon(readFileSync(join(root, pitch), "utf8"));
  if (herkunft === undefined) return [];
  if (herkunft.fehler !== undefined) return [`Teil ${phase.phase}: ${herkunft.fehler}`];
  return vorgaengerBefunde(phase.phase, herkunft.nach, root);
}
