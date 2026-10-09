import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";
import { MIN_AGENT_SEKUNDEN, budgetFehlt, budgetMinuten, restSekunden } from "./agent.mjs";
import { BLOCKIERT, SAUBER, WEITER, leseJson, schreibeJson, setzeAusgaben } from "./ausgabe.mjs";
import { IDS, befund } from "./befunde.mjs";
import { arbeitsbaumAenderungen, patchPruefsumme, schreibePatch } from "./patch.mjs";
import { ALTFUNKTION, BASIS, KNIP, basisVergleich, restBefunde } from "./sorten.mjs";
import { DATEI as VORPRUEFUNG, ORDNER } from "./vorpruefen.mjs";
import { DATEI } from "./waehlen.mjs";
import { eslintBefehl, fuehreAus, paketBefehl } from "./werkzeuge.mjs";

export const FIXER_PATCH = "fixer.patch";
export const BUDGET_NAME = "Aufräumen";
const UNBENUTZT = "no-unused-vars";
const KNIP_EXIT_BEFUNDE = 1;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

function unbenutzte(root, datei) {
  if (!existsSync(join(root, datei))) return 0;
  const lauf = fuehreAus(eslintBefehl(["--format", "json", datei]), root);
  const meldungen = JSON.parse(lauf.stdout || "[]").flatMap(({ messages }) => messages);
  return meldungen.filter(({ ruleId }) => ruleId === UNBENUTZT).length;
}

function lintGruen(root, datei) {
  return fuehreAus(eslintBefehl([datei]), root).status === EXIT_GRUEN;
}

export function knipFix(root, datei) {
  const lauf = fuehreAus(paketBefehl("knip", ["--fix", "--fix-type", "exports,types", "--no-progress"]), root);
  if (lauf.status !== EXIT_GRUEN && lauf.status !== KNIP_EXIT_BEFUNDE) {
    throw new Error(`knip --fix ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr.trim()}`);
  }
  const fremde = arbeitsbaumAenderungen(root).filter((pfad) => pfad !== datei);
  if (fremde.length > 0) gitAusgabe(["checkout", "HEAD", "--", ...fremde], root);
  return fremde;
}

export function eslintFix(root, datei) {
  const pfad = join(root, datei);
  if (!existsSync(pfad)) return false;
  const vorher = readFileSync(pfad);
  fuehreAus(eslintBefehl(["--fix", datei]), root);
  if (lintGruen(root, datei)) return true;
  writeFileSync(pfad, vorher);
  return false;
}

export function fixe(root, ziel) {
  if (ziel.sorte === BASIS) {
    basisVergleich(ziel.arten[0], root, ["--basis-kuerzen"]);
    return { agent: false, rest: 0, zurueckgesetzt: [] };
  }
  const vorher = unbenutzte(root, ziel.datei);
  const zurueckgesetzt = ziel.sorte === KNIP ? knipFix(root, ziel.datei) : [];
  if (ziel.sorte !== ALTFUNKTION) eslintFix(root, ziel.datei);
  const rest = restBefunde(ziel, root).length;
  const nachher = unbenutzte(root, ziel.datei);
  return { agent: rest > 0 || nachher > vorher, rest, zurueckgesetzt, unbenutzt: { vorher, nachher } };
}

function agentSchritt(root, { ziel, start }) {
  const minuten = budgetMinuten(root, BUDGET_NAME);
  if (minuten === null) return { ausgang: BLOCKIERT, grund: budgetFehlt(BUDGET_NAME), agent: false, rot: true };
  const sekunden = restSekunden(minuten, { start, jetzt: Date.now() });
  if (sekunden >= MIN_AGENT_SEKUNDEN) return { ausgang: WEITER, grund: "", agent: true, minuten, rot: false };
  const text = `Für den Agenten blieben nur ${sekunden} s im Budget von ${minuten} Minuten.`;
  return { ausgang: BLOCKIERT, grund: `nur noch ${sekunden} s im Budget`, agent: false, befunde: [befund(IDS.budget, ziel.datei, text)], rot: false };
}

function schrittFuer(root, { kandidat, fix, patch, start }) {
  if (fix.agent && kandidat.agentErlaubt) return agentSchritt(root, { ziel: kandidat, start });
  const fertig = patch !== "" && fix.rest === 0 && (kandidat.agentErlaubt || lintGruen(root, kandidat.datei));
  return fertig ? { ausgang: WEITER, grund: "", agent: false, rot: false } : null;
}

function versuche(root, { ziel, verzeichnis, start }) {
  const versucht = [];
  for (const kandidat of ziel.kandidaten ?? [ziel]) {
    gitAusgabe(["reset", "-q", "--hard", "HEAD"], root);
    const aktuell = { ...ziel, ...kandidat };
    const fix = fixe(root, aktuell);
    const patch = schreibePatch(root, join(verzeichnis, FIXER_PATCH));
    const schritt = schrittFuer(root, { kandidat: aktuell, fix, patch, start });
    versucht.push(kandidat.datei);
    if (schritt) return { aktuell, fix, patch, schritt, versucht };
  }
  writeFileSync(join(verzeichnis, FIXER_PATCH), "");
  const grund = `kein Kandidat ließ sich ohne Agent beheben (${versucht.join(", ")})`;
  return { aktuell: ziel, fix: { rest: null, zurueckgesetzt: [] }, patch: "", schritt: { ausgang: SAUBER, grund, agent: false, rot: false }, versucht };
}

function ergebnisDer(ziel, { aktuell, fix, schritt, versucht }) {
  const { rot, befunde = [], ...rest } = schritt;
  const ergebnis = { ...aktuell, ...rest, befunde: [...ziel.befunde, ...befunde], rest: fix.rest, unbenutzt: fix.unbenutzt ?? null, versucht };
  return { ergebnis, rot };
}

export async function befehl({ ordner }, root) {
  const verzeichnis = join(ordner, ORDNER);
  const ziel = leseJson(verzeichnis, DATEI);
  if (ziel?.ausgang !== WEITER) throw new Error("es gibt kein Ziel zum Aufräumen");
  const start = leseJson(verzeichnis, VORPRUEFUNG)?.start ?? new Date().toISOString();
  const versuch = versuche(root, { ziel, verzeichnis, start });
  const { aktuell, fix, patch } = versuch;
  const { ergebnis, rot } = ergebnisDer(ziel, versuch);
  schreibeJson(verzeichnis, DATEI, ergebnis);
  setzeAusgaben({ ausgang: ergebnis.ausgang, grund: ergebnis.grund, agent: ergebnis.agent ? "ja" : "nein", patch_sha: patchPruefsumme(patch) });
  console.log(`Fixer: ${ergebnis.ausgang} für ${aktuell.datei}, Agent ${ergebnis.agent ? "ja" : "nein"}${ergebnis.grund ? ` (${ergebnis.grund})` : ""}`);
  if (fix.zurueckgesetzt.length > 0) console.log(`Zurückgesetzte Änderungen von knip --fix: ${fix.zurueckgesetzt.join(", ")}`);
  return rot ? EXIT_ROT : EXIT_GRUEN;
}
