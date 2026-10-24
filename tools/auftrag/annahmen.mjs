import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { istPitchPhase } from "./format.mjs";
import { abschnitte } from "./planung/abschnitte.mjs";

export const ANNAHMEN = "Ausgangslage und Annahmen";
const KOPF = `## ${ANNAHMEN}`;
const PLAENE = "plaene";
const DESIGN = "design.md";
const PITCH = "pitch.md";
export const VORGABEN = ["## Fallen", "## Nicht-Ziele"];
const ZWECK = `Test- und Bau-Agent einer Phase aus einem Pitch bekommen den Abschnitt „${ANNAHMEN}“ aus dem Design Doc wörtlich, damit Abnahmetest und Code auf denselben Tatsachen stehen: Datenformate, vorhandene Bausteine, was das System schon tut. Ohne ihn legt der Test-Agent Testdaten nach eigener Vermutung an. Echte Behebung: den Abschnitt im Design Doc ergänzen. Ausweg: eine Entscheidungsnotiz im Phasen-Issue, warum diese Phase ohne Annahmen gebaut werden soll; dann entscheidet Antonio.`;

function planDatei(phase, name) {
  return istPitchPhase(phase.phase) ? `${PLAENE}/${phase.phase}/${name}` : null;
}

export function designPfad(phase) {
  return planDatei(phase, DESIGN);
}

export function pitchPfad(phase) {
  return planDatei(phase, PITCH);
}

export function vorgabenAusPitch(text) {
  const { abschnitte: gefunden } = abschnitte(text, VORGABEN);
  return [...gefunden.values()].join("\n\n");
}

function ohneKopf(ausschnitt) {
  const [, ...zeilen] = ausschnitt.split("\n");
  return zeilen.join("\n").trim();
}

export function annahmenAus(root, design) {
  const datei = join(root, design);
  if (!existsSync(datei)) return { befunde: [`${design} fehlt; die Phase kommt aus einem Pitch und braucht den Abschnitt „${ANNAHMEN}“`] };
  const { abschnitte: gefunden, befunde } = abschnitte(readFileSync(datei, "utf8"), [KOPF]);
  if (befunde.length > 0) return { befunde: befunde.map((befund) => `${design}: ${befund}`) };
  const text = ohneKopf(gefunden.get(KOPF));
  return text === "" ? { befunde: [`${design}: der Abschnitt „${ANNAHMEN}“ ist leer`] } : { text, befunde: [] };
}

export function annahmenBefunde(phase, root) {
  const design = designPfad(phase);
  const befunde = design === null ? [] : annahmenAus(root, design).befunde;
  return befunde.length > 0 ? [...befunde, ZWECK] : [];
}
