import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { ausgabenAus } from "../../../tools/tests-ausmisten/ausgaben.mjs";
import { probeDirectory } from "../probe-repo.js";
import { ausmistenRepo, starte } from "./hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT } from "./messung.mjs";

export { EXIT_GRUEN, EXIT_ROT };

const WERKZEUG = "tools/tests-ausmisten/totcode.mjs";
const ERSATZ = new URL("stryker-ersatz.mjs", import.meta.url).href;
const SCHRITTE = [
  ["planen", "plan"],
  ["basis", "basis"],
  ["kopf", "kopf"],
  ["entscheiden", "ergebnis"],
];

export function leseStufe(daten, name) {
  const datei = join(daten, name, `${name}.json`);
  return existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : undefined;
}

function argumenteFuer(befehl, { repo, kopfSha, daten }) {
  if (befehl !== "planen") return ["--daten", daten];
  return ["--basis", repo.master, "--kopf", kopfSha, "--liste", join(daten, "liste.json")];
}

export function schritt(stand, [befehl, name]) {
  const ausgabe = join(stand.daten, `${name}.txt`);
  writeFileSync(ausgabe, "");
  const args = [befehl, ...argumenteFuer(befehl, stand), "--aus", join(stand.daten, name)];
  const umgebung = { ...stand.umgebung, ...stand.summen, GITHUB_OUTPUT: ausgabe };
  return starte(WERKZEUG, { args, cwd: stand.repo.ordner, umgebung }).then((lauf) => ({
    ...lauf,
    summe: [`${name.toUpperCase()}_PRUEFSUMME`, ausgabenAus(ausgabe).pruefsumme ?? ""],
  }));
}

export async function totcodeLauf(context, { basis = {}, kopf = {}, weg = [], liste, regeln }) {
  const repo = ausmistenRepo(context, basis);
  const kopfSha = repo.committe(kopf, weg);
  repo.git(["checkout", "-q", repo.master]);
  const daten = probeDirectory(context, {
    "liste.json": JSON.stringify(liste),
    "regeln.json": JSON.stringify(regeln),
  });
  const umgebung = {
    NODE_ENV: "test",
    NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${ERSATZ}`.trim(),
    STRYKER_ERSATZ: join(daten, "regeln.json"),
  };
  const stand = { repo, kopfSha, daten, umgebung, summen: {}, laeufe: {} };
  for (const eintrag of SCHRITTE) {
    const lauf = await schritt(stand, eintrag);
    const [variable, summe] = lauf.summe;
    stand.summen[variable] = summe;
    stand.laeufe[eintrag[0]] = lauf;
    if (lauf.status !== EXIT_GRUEN && eintrag[0] !== "entscheiden") break;
  }
  const stufen = Object.fromEntries(SCHRITTE.map(([, name]) => [name, leseStufe(daten, name)]));
  return { ...stand, ...stufen };
}
