import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execPath } from "node:process";

import { entferneArbeitsordner, legeArbeitsordnerAn } from "./arbeitsordner.mjs";
import { git } from "./pfade.mjs";

const GITLEAKS_VERSION = "8.30.1";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const VERSION_VORSILBE = /^v/;
const NUR_COMMIT = "^{commit}";
const GITLEAKS_OPTION = "--gitleaks <pfad>";

function pruefungen({ master, kopf, gitleaks }) {
  const basis = ["--basis", master];
  return [
    {
      name: "Secret-Scan",
      befehl: gitleaks,
      args: [
        "git",
        "--config",
        "gitleaks.toml",
        "--redact",
        "--verbose",
        "--no-banner",
        "--exit-code",
        "1",
        `--log-opts=${master}..${kopf}`,
        ".",
      ],
    },
    {
      name: "Commit-Prüfung",
      befehl: "npx",
      args: ["--no-install", "commitlint", "--from", master, "--to", kopf, "--verbose"],
    },
    { name: "Lint", befehl: "npm", args: ["run", "lint"] },
    {
      name: "Lint neuer Funktionen",
      befehl: execPath,
      args: ["tools/lint-neue-funktionen.mjs", ...basis],
    },
    {
      name: "Kommentar-Wanderung",
      befehl: execPath,
      args: ["tools/kommentar-wanderung.mjs", ...basis],
    },
    {
      name: "Keine neuen Kommentare",
      befehl: execPath,
      args: ["tools/neue-kommentare.mjs", ...basis],
    },
  ];
}

function gitleaksFehler(gitleaks) {
  if (gitleaks === undefined) {
    return `Die Option ${GITLEAKS_OPTION} fehlt; ohne Secret-Scan (gitleaks ${GITLEAKS_VERSION}) misst lokal nicht.`;
  }
  const lauf = spawnSync(gitleaks, ["version"], { encoding: "utf8" });
  const version = (lauf.stdout ?? "").trim().replace(VERSION_VORSILBE, "");
  if (lauf.status === EXIT_GRUEN && version === GITLEAKS_VERSION) return undefined;
  const gemeldet = version || lauf.error?.message || "nichts";
  return `${gitleaks} ist nicht gitleaks ${GITLEAKS_VERSION} (gemeldet: ${gemeldet}).`;
}

function fuehreAus(pruefung, ordner) {
  console.log(`Vorprüfung: ${pruefung.name}`);
  const lauf = spawnSync(pruefung.befehl, pruefung.args, { cwd: ordner, stdio: "inherit" });
  if (lauf.status === EXIT_GRUEN) return [];
  const ausgang = lauf.status ?? lauf.signal ?? lauf.error?.message;
  return [`${pruefung.name} rot (${ausgang})`];
}

function ausfuehrbar(gitleaks) {
  return gitleaks.includes(sep) ? resolve(gitleaks) : gitleaks;
}

export function vorpruefen({ master, kopf, ordner, gitleaks }) {
  const fehler = gitleaksFehler(gitleaks);
  if (fehler !== undefined) return [fehler];
  mkdirSync(ordner, { recursive: true });
  const ziel = legeArbeitsordnerAn(join(ordner, "kopf"), kopf);
  try {
    const liste = pruefungen({ master, kopf, gitleaks: ausfuehrbar(gitleaks) });
    return liste.flatMap((pruefung) => fuehreAus(pruefung, ziel));
  } finally {
    entferneArbeitsordner(ziel);
  }
}

export function meldeVorpruefung(verstoesse) {
  for (const verstoss of verstoesse) console.log(`Vorprüfung rot: ${verstoss}`);
  if (verstoesse.length === 0) console.log("Vorprüfung: grün");
  return verstoesse.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

export function vorpruefenBefehl({ kopf, gitleaks, aus }) {
  const master = git(["rev-parse", "HEAD"]).trim();
  const ziel = git(["rev-parse", "--verify", `${kopf}${NUR_COMMIT}`]).trim();
  return meldeVorpruefung(vorpruefen({ master, kopf: ziel, ordner: aus, gitleaks }));
}
