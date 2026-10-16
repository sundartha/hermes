import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { zitiert } from "./zeilen.mjs";

export const BELEGE = ".fortschritt";
export const GRUEN = "grün";
export const ROT = "rot";
const JSON_EINRUECKUNG = 2;
const MIO = 1_000_000;
const NACHKOMMA = 1;
const HINWEISE_DES_BAUS = "Hinweise des Bau-Agenten:";
const MAX_NOTIZ_ZEICHEN = 20_000;
const LEERRAUM = /\s\S*$/;
const ERSTE_ZUSATZNUMMER = 2;

function zitierteHinweise(text) {
  return [HINWEISE_DES_BAUS, ...zitiert(text)];
}

export function hinweiseDesBaus(agenten = []) {
  const antwort = (agenten.findLast(({ rolle }) => rolle === "bau")?.antwort ?? "").trim();
  if (antwort === "") return [];
  return zitierteHinweise(antwort);
}

function gekuerzt(text) {
  if (text.length <= MAX_NOTIZ_ZEICHEN) return { text, gekuerzt: false };
  const vorne = text.slice(0, MAX_NOTIZ_ZEICHEN + 1);
  const ende = LEERRAUM.exec(vorne)?.index ?? MAX_NOTIZ_ZEICHEN;
  return { text: vorne.slice(0, ende).trimEnd(), gekuerzt: true };
}

export function notizAuszug(antwort, sitzung) {
  const kurz = gekuerzt(antwort.trim());
  if (kurz.text === "") return "";
  const ort = `die volle Antwort steht in Sitzung ${sitzung}`;
  return kurz.gekuerzt ? `${kurz.text} … [gekürzt; ${ort}]` : `${kurz.text}\n\n(Volle Antwort: Sitzung ${sitzung})`;
}

export function hinweiseFuerNotiz(agenten, entnimmVolleAntwort) {
  const bau = agenten.findLast(({ rolle }) => rolle === "bau");
  const auszug = bau ? notizAuszug(entnimmVolleAntwort(bau), bau.sitzung) : "";
  if (auszug === "") return [];
  return zitierteHinweise(auszug);
}

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

function fruehereRunde(pfad, { runde }) {
  if (runde === undefined || !existsSync(pfad)) return null;
  try {
    const vorher = JSON.parse(readFileSync(pfad, "utf8")).runde;
    return Number.isInteger(vorher) && vorher !== runde ? vorher : null;
  } catch {
    return null;
  }
}

function freierRundenPfad(root, { phase, auftrag }, runde) {
  const name = `${auftrag}.runde-${runde}`;
  let pfad = belegPfad(root, phase, name);
  for (let nummer = ERSTE_ZUSATZNUMMER; existsSync(pfad); nummer += 1) pfad = belegPfad(root, phase, `${name}.${nummer}`);
  return pfad;
}

export function schreibeBeleg(root, beleg) {
  mkdirSync(belegVerzeichnis(root, beleg.phase), { recursive: true });
  const pfad = belegPfad(root, beleg.phase, beleg.auftrag);
  const runde = fruehereRunde(pfad, beleg);
  if (runde !== null) renameSync(pfad, freierRundenPfad(root, beleg, runde));
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
  for (const { rolle, agent, exitCode, grund } of beleg.agenten) {
    console.log(`  Agent ${agent} (${rolle}): Exit ${exitCode}${grund ? ` (${grund})` : ""}`);
  }
  for (const { name, befehl, exitCode } of beleg.pruefungen) {
    console.log(`  ${exitCode === 0 ? "✓" : "✗"} ${name}: Exit ${exitCode}  ${befehl}`);
  }
  if (beleg.kosten) console.log(`  ${kostenZeile(beleg.kosten)}`);
  console.log(`  Beleg: ${pfad}`);
}
