import { block } from "./lib.mjs";
import { schreibziel } from "./rolle.mjs";

const BELEGE = ".fortschritt";

function main() {
  const ziel = schreibziel();
  if (ziel === null) return;
  if (ziel.relativ !== BELEGE && !ziel.relativ.startsWith(`${BELEGE}/`)) return;
  block([`${ziel.relativ}: Belege schreibt nur tools/auftrag.mjs.`]);
}

main();
