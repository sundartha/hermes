import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { EXIT_AUFRUF, EXIT_VORHANDEN, NeuFehler } from "./fehler.mjs";
import { pruefeName } from "./namen.mjs";
import { planFachdatei, planRoute, planTest } from "./arten.mjs";

const ARTEN = new Map([
  ["test", planTest],
  ["route", planRoute],
  ["fachdatei", planFachdatei],
]);
const AUFRUF = "Aufruf: npm run neu -- ART ZIEL NAME";

function pruefeVorhanden(wurzel, dateien) {
  const vorhanden = dateien
    .map(({ pfad }) => pfad)
    .filter((pfad) => existsSync(join(wurzel, pfad)));
  if (vorhanden.length > 0) {
    throw new NeuFehler(
      EXIT_VORHANDEN,
      `Es gibt schon: ${vorhanden.join(", ")}. Nichts wurde geändert.`,
    );
  }
}

export async function legeAn({ art, ziel, name, wurzel }) {
  const planer = ARTEN.get(art);
  if (planer === undefined || ziel === undefined || name === undefined) {
    throw new NeuFehler(EXIT_AUFRUF, `${AUFRUF} (Arten: ${[...ARTEN.keys()].join(", ")})`);
  }
  const plan = await planer(wurzel, ziel, pruefeName(name));
  pruefeVorhanden(wurzel, plan.dateien);
  for (const { pfad, inhalt } of plan.dateien) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt, { flag: "wx" });
  }
  for (const { pfad, inhalt } of plan.karten) writeFileSync(join(wurzel, pfad), inhalt);
  return plan;
}
