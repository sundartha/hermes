import { readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ABLAGE = /\.json$/;
const ENTWURF = ".teil";
const WEG = "ENOENT";

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
      if (fehler.code !== WEG) throw fehler;
    }
  };
}

function aufgeloest(testdatei) {
  try {
    return realpathSync(testdatei);
  } catch (fehler) {
    if (fehler.code !== WEG) throw fehler;
    return undefined;
  }
}

export function mitKindern(perTest, ordner) {
  const nachPfad = new Map(Object.keys(perTest).map((testdatei) => [realpathSync(testdatei), testdatei]));
  const ergaenzt = { ...perTest };
  const ohneTestdatei = [];
  for (const datei of readdirSync(ordner).filter((name) => ABLAGE.test(name))) {
    const { testdatei, abdeckung } = JSON.parse(readFileSync(join(ordner, datei), "utf8"));
    const ziel = nachPfad.get(aufgeloest(testdatei));
    if (ziel === undefined) ohneTestdatei.push(testdatei);
    else ergaenzt[ziel] = hinzu(ergaenzt[ziel], abdeckung);
  }
  return { perTest: ergaenzt, ohneTestdatei };
}
