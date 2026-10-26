import { TEST_STATISCH, zweckBlock } from "./auftrag/zweck.mjs";
import { direktAusfuehren } from "./pr-aenderungen.mjs";
import { echtWartenImArbeitsbaum, echteWartezeitenListe } from "./testlaufzeit/echt-warten-statisch.mjs";
import { testsOhneFestenNamen } from "./testwirkung.mjs";

const AUFRUF = "Aufruf: node tools/test-statisch.mjs --basis <commit>";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const KEINE_AUSNAHME = [];

async function pruefen(root, basis) {
  const befunde = [
    ...(await testsOhneFestenNamen(basis)),
    ...echtWartenImArbeitsbaum(root, echteWartezeitenListe(root, { ohneListe: KEINE_AUSNAHME })),
  ];
  for (const befund of befunde) console.log(`Verstoß: ${befund}`);
  if (befunde.length === 0) {
    console.log("grün: feste Testnamen und echte Wartezeiten ohne Befund.");
    return EXIT_GRUEN;
  }
  console.log(`rot: ${befunde.length} Befunde zu festen Testnamen und echten Wartezeiten.`);
  console.log(zweckBlock(TEST_STATISCH).join("\n"));
  return EXIT_ROT;
}

await direktAusfuehren(import.meta.url, { aufruf: AUFRUF, pruefen });
