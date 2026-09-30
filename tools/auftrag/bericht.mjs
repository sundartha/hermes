import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BELEGE = ".fortschritt";
export const GRUEN = "grün";
export const ROT = "rot";
const JSON_EINRUECKUNG = 2;
const MIO = 1_000_000;
const NACHKOMMA = 1;

export function belegVerzeichnis(root, phase) {
  return join(root, BELEGE, phase);
}

export function belegPfad(root, phase, kennung) {
  return join(belegVerzeichnis(root, phase), `${kennung}.json`);
}

export function fingerabdruck(root) {
  const verzeichnis = join(root, BELEGE);
  const hash = createHash("sha256");
  if (!existsSync(verzeichnis)) return hash.digest("hex");
  const namen = readdirSync(verzeichnis, { recursive: true }).map(String).sort();
  for (const name of namen) {
    const datei = join(verzeichnis, name);
    hash.update(name);
    hash.update(statSync(datei).isFile() ? readFileSync(datei) : "");
  }
  return hash.digest("hex");
}

export function schreibeBeleg(root, beleg) {
  mkdirSync(belegVerzeichnis(root, beleg.phase), { recursive: true });
  const pfad = belegPfad(root, beleg.phase, beleg.auftrag);
  writeFileSync(pfad, `${JSON.stringify(beleg, null, JSON_EINRUECKUNG)}\n`);
  return pfad;
}

function kostenZeile({ gemessen, summe }) {
  if (!gemessen) return "Kosten: nicht gemessen, mindestens ein Transkript fehlt.";
  const millionen = (summe.gesamt / MIO).toFixed(NACHKOMMA);
  return `Kosten: ${millionen} Mio. Token in ${summe.turns} Antworten, davon Cache-Reads ${(summe.cacheRead / MIO).toFixed(NACHKOMMA)} Mio.`;
}

export function druckeBeleg(beleg, pfad) {
  console.log(`Auftrag ${beleg.auftrag}: ${beleg.ergebnis}${beleg.grund ? ` (${beleg.grund})` : ""}`);
  for (const { rolle, agent, exitCode } of beleg.agenten) {
    console.log(`  Agent ${agent} (${rolle}): Exit ${exitCode}`);
  }
  for (const { name, befehl, exitCode } of beleg.pruefungen) {
    console.log(`  ${exitCode === 0 ? "✓" : "✗"} ${name}: Exit ${exitCode}  ${befehl}`);
  }
  if (beleg.kosten) console.log(`  ${kostenZeile(beleg.kosten)}`);
  console.log(`  Beleg: ${pfad}`);
}
