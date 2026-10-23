import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const AUSFUEHRBAR = 0o755;
const GRUEN = "#!/bin/sh\nexit 0\n";
const ERSATZ = {
  semgrep: '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("1.0.0");\nelse process.exitCode = 2;\n',
  pg_isready: GRUEN,
};
const ERSATZ_POSTGRES = "postgres://ersatz@localhost:5432/ersatz";

export function mitErsatzWerkzeugen(werkzeug) {
  const ordner = join(werkzeug, "ersatz-bin");
  mkdirSync(ordner, { recursive: true });
  for (const [name, inhalt] of Object.entries(ERSATZ)) writeFileSync(join(ordner, name), inhalt, { mode: AUSFUEHRBAR });
  return { PATH: `${ordner}${delimiter}${process.env.PATH}`, HERMES_TEST_POSTGRES_URL: ERSATZ_POSTGRES };
}

const CI_LOKAL_AUFRUFE = "ci-lokal-aufrufe.jsonl";
const CI_LOKAL_ERSATZ = "ci-lokal-ersatz.mjs";
export const CI_LOKAL_ROT = "ci-lokal: rot: jscpd";

function ersatzCiLokal(exitCode) {
  const ausgabe = exitCode === 0 ? "ci-lokal: grün" : `jscpd rot 1.0s\n    102 Kopien\n${CI_LOKAL_ROT}`;
  return [
    'import { appendFileSync } from "node:fs";',
    'import { join } from "node:path";',
    `appendFileSync(join(process.env.HOME, ${JSON.stringify(CI_LOKAL_AUFRUFE)}), JSON.stringify(process.argv.slice(2)) + "\\n");`,
    `console.log(${JSON.stringify(ausgabe)});`,
    `process.exitCode = ${exitCode};`,
    "",
  ].join("\n");
}

export function mitCiLokal(paketJson, exitCode) {
  const paket = JSON.parse(paketJson);
  const scripts = { ...paket.scripts, "ci:lokal": `node ${CI_LOKAL_ERSATZ}` };
  return { "package.json": JSON.stringify({ ...paket, scripts }), [CI_LOKAL_ERSATZ]: ersatzCiLokal(exitCode) };
}

export function ciLokalAufrufe(home) {
  const datei = join(home, CI_LOKAL_AUFRUFE);
  if (!existsSync(datei)) return [];
  return readFileSync(datei, "utf8").split("\n").filter(Boolean).map((zeile) => JSON.parse(zeile));
}
