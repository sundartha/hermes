import { execFileSync } from "node:child_process";
import { mitAktivemMutanten } from "../../tools/mutationspruefung/zustand.mjs";
import { BASE_ENV, ROOT } from "../helpers.js";

const TEST_UMGEBUNG = "test";

function pruefeNodeEnv(ueberschreiben) {
  if (!Object.hasOwn(ueberschreiben, "NODE_ENV") || ueberschreiben.NODE_ENV === TEST_UMGEBUNG) return;
  throw new Error(
    `gebauteKonfiguration: NODE_ENV=${String(ueberschreiben.NODE_ENV)} ist nicht erlaubt, ` +
      `die Konfiguration liest dann die lokale .env; nur "${TEST_UMGEBUNG}" ist zulässig`,
  );
}

function kindUmgebung(ueberschreiben) {
  pruefeNodeEnv(ueberschreiben);
  const umgebung = mitAktivemMutanten({ PATH: process.env.PATH, ...BASE_ENV, NODE_ENV: TEST_UMGEBUNG, ...ueberschreiben });
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
  const gebaut = JSON.parse(ausgabe);
  const ohneWert = felder.filter((feld) => !Object.hasOwn(gebaut, feld));
  if (ohneWert.length > 0) throw new Error(`gebaute Konfiguration ohne Wert für: ${ohneWert.join(", ")}`);
  return gebaut;
}
