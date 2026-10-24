import { readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ABLAGE = /\.json$/;
const ENTWURF = ".teil";
const ORDNER_WEG = "ENOENT";

function hinzu(summe, zaehler) {
  const neu = { ...summe };
  for (const [mutant, treffer] of Object.entries(zaehler)) neu[mutant] = (neu[mutant] ?? 0) + treffer;
  return neu;
}

export function ablage({ datei, testdatei, abdeckung }) {
  const entwurf = `${datei}${ENTWURF}`;
  return () => {
    const stand = abdeckung();
    if (stand === undefined) return;
    const summe = Object.values(stand.perTest).reduce(hinzu, stand.static);
    try {
      writeFileSync(entwurf, JSON.stringify({ testdatei, abdeckung: summe }));
      renameSync(entwurf, datei);
    } catch (fehler) {
      if (fehler.code !== ORDNER_WEG) throw fehler;
    }
  };
}

export function mitKindern(perTest, ordner) {
  const nachPfad = new Map(Object.keys(perTest).map((testdatei) => [realpathSync(testdatei), testdatei]));
  const ergaenzt = { ...perTest };
  for (const datei of readdirSync(ordner).filter((name) => ABLAGE.test(name))) {
    const { testdatei, abdeckung } = JSON.parse(readFileSync(join(ordner, datei), "utf8"));
    const ziel = nachPfad.get(realpathSync(testdatei));
    if (ziel === undefined) throw new Error(`Kind-Abdeckung ohne Testdatei dieses Probelaufs: ${testdatei}`);
    ergaenzt[ziel] = hinzu(ergaenzt[ziel], abdeckung);
  }
  return ergaenzt;
}
