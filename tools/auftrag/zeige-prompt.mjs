import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdout } from "node:process";

import { bauPrompt, testAgentPrompt, testumbauPrompt } from "./agenten.mjs";
import { EXIT_GRUEN, gueltigerAuftrag, meldeBefunde } from "./befehle.mjs";
import { TESTUMBAU, brauchtRotenTest } from "./format.mjs";
import { auftragsKontext } from "./lauf.mjs";

export const TESTAUSGABE_PLATZHALTER =
  "[Platzhalter von zeige-prompt: Hier steht im Lauf die Ausgabe des Abnahmetests oder des roten Tests. Mit --testausgabe <datei> steht hier deren Inhalt. Zusätze, die der Lauf erst nach dem Testlauf anhängt (Bisektion, spätere Runden), fehlen.]";

function rollenPrompt(kontext, rolle, testausgabe) {
  const { phase, auftrag, root } = kontext;
  if (auftrag.art === TESTUMBAU) return rolle === "test" ? testumbauPrompt(phase, auftrag, root) : null;
  if (rolle === "bau") return bauPrompt(kontext, testausgabe);
  return rolle === "test" && brauchtRotenTest(auftrag) ? testAgentPrompt(kontext) : null;
}

export function zeigePrompt(phasendatei, kennung, { rolle, testausgabe, root }) {
  const { phase, auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) return meldeBefunde(befunde);
  const ausgabe = testausgabe === undefined ? TESTAUSGABE_PLATZHALTER : readFileSync(resolve(root, testausgabe), "utf8");
  const text = rollenPrompt(auftragsKontext(phase, auftrag, root), rolle, ausgabe);
  if (text === null) return meldeBefunde([`Auftrag ${kennung} hat die Art ${auftrag.art}; der Lauf startet dafür keinen ${rolle === "test" ? "Test" : "Bau"}-Agenten.`]);
  stdout.write(text);
  return EXIT_GRUEN;
}
