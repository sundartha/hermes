import { execFileSync } from "node:child_process";
import { BASE_ENV, ROOT } from "../helpers.js";

function kindUmgebung(ueberschreiben) {
  const umgebung = { PATH: process.env.PATH, ...BASE_ENV, ...ueberschreiben, NODE_ENV: "test" };
  return Object.fromEntries(Object.entries(umgebung).filter(([, wert]) => wert !== undefined));
}

function kindSkript(felder) {
  return [
    `const felder = ${JSON.stringify(felder)};`,
    'const lesen = (quelle, feld) => feld.split(".").reduce((wert, teil) => wert?.[teil], quelle);',
    'import("./src/config.js").then(({ config }) => process.stdout.write(',
    "  JSON.stringify(Object.fromEntries(felder.map((feld) => [feld, lesen(config, feld)]))),",
    "));",
  ].join("\n");
}

export function gebauteKonfiguration(ueberschreiben, felder) {
  const ausgabe = execFileSync(process.execPath, ["--input-type=module", "-e", kindSkript(felder)], {
    cwd: ROOT,
    env: kindUmgebung(ueberschreiben),
    encoding: "utf8",
  });
  return JSON.parse(ausgabe);
}
