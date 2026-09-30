import { existsSync, readFileSync } from "node:fs";
import { env } from "node:process";

import { block } from "./lib.mjs";
import { schreibziel } from "./rolle.mjs";

const PRODUKTCODE = "src/";
const TESTLAUF = /\bnpm\b[^;&|]*\btest\b|testbaenke-run\.mjs/;

function eintraege(transkript) {
  if (typeof transkript !== "string" || !existsSync(transkript)) return [];
  return readFileSync(transkript, "utf8")
    .split("\n")
    .flatMap((zeile) => {
      try {
        return [JSON.parse(zeile)];
      } catch {
        return [];
      }
    });
}

function bloecke(eintrag) {
  const inhalt = eintrag?.message?.content;
  return Array.isArray(inhalt) ? inhalt : [];
}

function laeuftAbnahme(inhalt, abnahme) {
  const befehl = inhalt.input?.command;
  if (inhalt.type !== "tool_use" || inhalt.name !== "Bash" || typeof befehl !== "string") return false;
  return befehl.includes(abnahme) && TESTLAUF.test(befehl);
}

function hatAbnahmeAusgefuehrt(transkript, abnahme) {
  const alle = eintraege(transkript).flatMap(bloecke);
  const laeufe = new Set(alle.filter((eintrag) => laeuftAbnahme(eintrag, abnahme)).map(({ id }) => id));
  return alle.some(({ type, tool_use_id: kennung }) => type === "tool_result" && laeufe.has(kennung));
}

function main() {
  const ziel = schreibziel();
  if (ziel === null || !ziel.relativ.startsWith(PRODUKTCODE)) return;
  const abnahme = env.HERMES_ABNAHME;
  if (!abnahme) block(["HERMES_ABNAHME fehlt; ohne Abnahmetest ist Schreiben unter src/ gesperrt."]);
  if (hatAbnahmeAusgefuehrt(ziel.input.transcript_path, abnahme)) return;
  block([
    `Schreibzugriff auf ${ziel.relativ} blockiert: führe zuerst den Abnahmetest selbst aus.`,
    `Befehl: npm --silent test -- ${abnahme}`,
  ]);
}

main();
