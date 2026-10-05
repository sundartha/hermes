import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { TESTGRUPPE } from "../testgruppe.mjs";

const MINDESTLUECKE = 4;
const HAELFTE = 2;
const NACHMESSUNG_FRIST_MS = 180_000;
const NACHKOMMASTELLEN = 10;
const TESTLAEUFER_VARIABLE = "NODE_TEST_CONTEXT";
const REPORTER = path.join(import.meta.dirname, "..", "testlaufzeit-reporter.mjs");

export function zeilenAus(datei) {
  return readFileSync(datei, "utf8")
    .split("\n")
    .filter((zeile) => zeile.trim() !== "")
    .map((zeile) => JSON.parse(zeile));
}

function runde(ms) {
  return Math.round(ms * NACHKOMMASTELLEN) / NACHKOMMASTELLEN;
}

function hoechstwerte(laeufe) {
  const werte = new Map();
  for (const { datei, ausklingen_ms: ausklingen } of laeufe.flat()) {
    if (ausklingen !== null) werte.set(datei, Math.max(werte.get(datei) ?? 0, ausklingen));
  }
  return werte;
}

function median(sortiert) {
  return sortiert[Math.floor(sortiert.length / HAELFTE)] ?? 0;
}

function groessteLuecke(sortiert) {
  const boden = median(sortiert);
  let beste = null;
  for (let i = 0; i + 1 < sortiert.length; i++) {
    const [unten, oben] = [sortiert[i], sortiert[i + 1]];
    const tauglich = unten >= boden && unten > 0;
    if (tauglich && (beste === null || oben / unten > beste.faktor)) {
      beste = { unten, oben, faktor: oben / unten };
    }
  }
  return beste;
}

export function grenzeAbleiten(laeufe) {
  const werte = hoechstwerte(laeufe);
  const luecke = groessteLuecke([...werte.values()].sort((links, rechts) => links - rechts));
  const reicht = luecke !== null && luecke.faktor >= MINDESTLUECKE;
  const grenze = reicht ? runde(Math.sqrt(luecke.unten * luecke.oben)) : null;
  const bestand = grenze === null ? [] : [...werte].filter(([, wert]) => wert > grenze);
  return {
    ausklingen_grenze_ms: grenze,
    ausklingen_bestand: bestand.map(([datei]) => datei).sort(),
    herleitung: {
      dateien: werte.size,
      luecke_ms: luecke && [luecke.unten, luecke.oben],
      faktor: luecke && runde(luecke.faktor),
    },
  };
}

function umgebungOhneTestlaeufer() {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== TESTLAEUFER_VARIABLE));
}

export function nachmessen(datei) {
  const ordner = mkdtempSync(path.join(tmpdir(), "testlaufzeit-"));
  const ziel = path.join(ordner, "nachmessung.jsonl");
  try {
    const lauf = spawnSync(
      process.execPath,
      [
        TESTGRUPPE,
        "--test",
        ...patternFlagsFor("regression"),
        `--test-reporter=${REPORTER}`,
        `--test-reporter-destination=${ziel}`,
        datei,
      ],
      { stdio: "ignore", timeout: NACHMESSUNG_FRIST_MS, env: umgebungOhneTestlaeufer() },
    );
    if (lauf.error) return null;
    return zeilenAus(ziel).find((zeile) => zeile.datei === datei)?.ausklingen_ms ?? null;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function urteilFuer(zeile, { grenze, bestand, messen }) {
  const { datei, ausklingen_ms: wert } = zeile;
  if (wert === null || wert <= grenze || bestand.has(datei)) return null;
  const nachgemessen = messen(datei);
  if (nachgemessen !== null && nachgemessen <= grenze) return null;
  const zweite =
    nachgemessen === null ? "Nachmessung ohne Ergebnis" : `nachgemessen ${nachgemessen} ms`;
  return `${datei}: Ausklingzeit ${wert} ms über der Grenze ${grenze} ms (${zweite}). Nach dem letzten Test läuft noch ein Zeitglied, Kindprozess oder Server, oder ein Hook auf oberster Ebene (after) ist langsam.`;
}

export function ausklingBefunde(zeilen, basis, messen = nachmessen) {
  const grenze = basis.ausklingen_grenze_ms;
  const bestand = new Set(basis.ausklingen_bestand);
  const fehlend = basis.ausklingen_bestand.filter((datei) => !existsSync(datei));
  const ueber =
    grenze === null ? [] : zeilen.map((zeile) => urteilFuer(zeile, { grenze, bestand, messen }));
  return [
    ...ueber.filter(Boolean),
    ...fehlend.map((datei) => `tools/basis/testlaufzeit.json: ${datei} gibt es nicht mehr`),
  ];
}
