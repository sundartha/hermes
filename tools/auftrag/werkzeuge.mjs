import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { TOOLS } from "../basis-vergleich.mjs";
import { MELDUNG, zweckBlock } from "./zweck.mjs";

export const POSTGRES_VARIABLE = "HERMES_TEST_POSTGRES_URL";
const MAX_GENANNTE_PAKETE = 3;

function ersteZeile(text) {
  return text.split("\n").find((zeile) => zeile.trim() !== "") ?? "";
}

function laeuftNicht(befehl, argumente, root) {
  const lauf = spawnSync(befehl, argumente, { cwd: root, encoding: "utf8" });
  if (lauf.error) return `${befehl} ließ sich nicht starten: ${lauf.error.message}`;
  return lauf.status === 0 ? null : `${befehl} endete mit Exit ${lauf.status}: ${ersteZeile(`${lauf.stderr}\n${lauf.stdout}`)}`;
}

function fehlendePakete(root) {
  const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const fehlend = Object.keys({ ...dependencies, ...devDependencies }).filter((name) => !existsSync(join(root, "node_modules", name, "package.json")));
  if (fehlend.length === 0) return null;
  const mehr = fehlend.length > MAX_GENANNTE_PAKETE ? ` und ${fehlend.length - MAX_GENANNTE_PAKETE} weitere` : "";
  return `nicht installiert: ${fehlend.slice(0, MAX_GENANNTE_PAKETE).join(", ")}${mehr}`;
}

function semgrepLaeuftNicht(root) {
  try {
    TOOLS.semgrep.version(root);
    return null;
  } catch (fehler) {
    return fehler.message.split("\n")[0];
  }
}

function postgresFehlt(root) {
  const adresse = env[POSTGRES_VARIABLE];
  if (!adresse) return `${POSTGRES_VARIABLE} ist nicht gesetzt`;
  return laeuftNicht("pg_isready", ["-q", "-d", adresse], root);
}

const WERKZEUGE = {
  pakete: {
    fehlt: fehlendePakete,
    befund: "Die Pakete aus package.json fehlen in node_modules; ohne sie brechen lint, tsc und die Tests ab",
    zweck: MELDUNG.PAKETE_FEHLEN,
  },
  postgres: {
    fehlt: postgresFehlt,
    befund: "Postgres für test:wirkung fehlt; ohne es überspringen die Postgres-Tests still",
    zweck: MELDUNG.POSTGRES_FEHLT,
  },
  semgrep: {
    fehlt: semgrepLaeuftNicht,
    befund: "semgrep läuft nicht; ohne ihn zählt kein Paar als nur Typen und lint bricht ab",
    zweck: MELDUNG.SEMGREP_FEHLT,
  },
};

export const ALLE_WERKZEUGE = Object.keys(WERKZEUGE);

export function werkzeugBefunde(root, namen = ALLE_WERKZEUGE) {
  return namen.flatMap((name) => {
    const { fehlt, befund, zweck } = WERKZEUGE[name];
    const grund = fehlt(root);
    return grund === null ? [] : [`${befund} (${grund}).`, ...zweckBlock(zweck)];
  });
}
