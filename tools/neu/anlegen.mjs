import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { EXIT_AUFRUF, EXIT_VORHANDEN, NeuFehler } from "./fehler.mjs";
import { pruefeName } from "./namen.mjs";
import { fuelle } from "./vorlagen.mjs";

const BEREICHE = "tools/bereiche.json";
const OHNE_DIENST = "werkzeuge";

function bereicheIn(wurzel) {
  return JSON.parse(readFileSync(join(wurzel, BEREICHE), "utf8"));
}

function bereichFuerTest(wurzel, bereich) {
  const namen = bereicheIn(wurzel).map((eintrag) => eintrag.bereich);
  if (bereich === OHNE_DIENST || !namen.includes(bereich)) {
    const erlaubt = namen.filter((name) => name !== OHNE_DIENST).join(", ");
    throw new NeuFehler(
      EXIT_AUFRUF,
      `Bereich ${JSON.stringify(bereich)} ist für einen Test nicht möglich (möglich: ${erlaubt}).`,
    );
  }
  return bereich;
}

function planTest(wurzel, bereich, name) {
  const ziel = bereichFuerTest(wurzel, bereich);
  return {
    dateien: [{ pfad: `test/${ziel}/${name}.test.js`, inhalt: fuelle("test", name) }],
    karten: [],
    hinweise: [],
  };
}

const ARTEN = { test: planTest };
const AUFRUF = `Aufruf: npm run neu -- <art> <ziel> <name>  (Arten: ${Object.keys(ARTEN).join(", ")})`;

function pruefeVorhanden(wurzel, dateien) {
  const vorhanden = dateien.filter(({ pfad }) => existsSync(join(wurzel, pfad)));
  if (vorhanden.length > 0) {
    throw new NeuFehler(
      EXIT_VORHANDEN,
      `Es gibt schon: ${vorhanden.map(({ pfad }) => pfad).join(", ")}. Nichts wurde geändert.`,
    );
  }
}

export async function legeAn({ art, ziel, name, wurzel }) {
  if (!Object.hasOwn(ARTEN, art) || ziel === undefined || name === undefined) {
    throw new NeuFehler(EXIT_AUFRUF, AUFRUF);
  }
  const plan = await ARTEN[art](wurzel, ziel, pruefeName(name));
  pruefeVorhanden(wurzel, plan.dateien);
  for (const { pfad, inhalt } of plan.dateien) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt, { flag: "wx" });
  }
  for (const { pfad, inhalt } of plan.karten) writeFileSync(join(wurzel, pfad), inhalt);
  return plan;
}
