import { after } from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import { abfragenZaehlendeHuelle, abwartenBisNichtsMehrLaeuft } from "./gemeinsam/pglite-instanz.js";
import { testkostenZaehler } from "./testkosten.js";

const PGLITE_NAME = "@electric-sql/pglite";
const PGLITE_PAKET = paketDateiFinden(PGLITE_NAME);
const PAKETE_ORDNER = path.resolve(path.dirname(PGLITE_PAKET), ...PGLITE_NAME.split("/").map(() => ".."));
export const VORLAGEN_ORDNER = path.join(PAKETE_ORDNER, ".cache", "hermes-pglite-vorlagen");
const STRYKER_VARIABLE = "__STRYKER_ACTIVE_MUTANT__";
const VORLAGE_UNABHAENGIG = "HERMES_VORLAGE_UNABHAENGIG";

function paketDateiFinden(name) {
  let ordner = path.dirname(fileURLToPath(import.meta.resolve(name)));
  for (;;) {
    const datei = path.join(ordner, "package.json");
    if (fs.existsSync(datei) && JSON.parse(fs.readFileSync(datei, "utf8")).name === name) return datei;
    const oben = path.dirname(ordner);
    if (oben === ordner) throw new Error(`package.json von ${name} nicht gefunden`);
    ordner = oben;
  }
}

const offene = new Set();
const datenbankStarts = testkostenZaehler("datenbankStarts");
const schliessVorgaenge = new WeakMap();

function pruefwert(schluesselTeile) {
  const hash = createHash("sha256");
  const teile = [
    fs.readFileSync(PGLITE_PAKET, "utf8"),
    process.env.TZ ?? "",
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...schluesselTeile,
  ];
  for (const teil of teile) hash.update(`${teil.length}:${teil}`);
  return hash.digest("hex");
}

async function abbildBauen(einrichten) {
  const pg = new PGlite();
  await einrichten(pg);
  const abbild = await pg.dumpDataDir("none");
  await pg.close();
  return abbild;
}

export async function vorlage(name, einrichten, schluesselTeile) {
  const kettensumme = process.env[VORLAGE_UNABHAENGIG];
  if (kettensumme !== undefined) return ausDemCache(name, einrichten, [...schluesselTeile, kettensumme]);
  if (process.env[STRYKER_VARIABLE] !== undefined) return abbildBauen(einrichten);
  return ausDemCache(name, einrichten, schluesselTeile);
}

async function ausDemCache(name, einrichten, schluesselTeile) {
  const ziel = path.join(VORLAGEN_ORDNER, `${name}-${pruefwert(schluesselTeile)}.tar`);
  if (fs.existsSync(ziel)) return new Blob([fs.readFileSync(ziel)]);
  const abbild = await abbildBauen(einrichten);
  fs.mkdirSync(VORLAGEN_ORDNER, { recursive: true });
  const zwischen = `${ziel}.${process.pid}.tmp`;
  fs.writeFileSync(zwischen, Buffer.from(await abbild.arrayBuffer()));
  fs.renameSync(zwischen, ziel);
  return abbild;
}

const LEERE_VORLAGE = await vorlage("leer", async () => {}, []);

async function flushesAbwartenOhneFehlerFolge(storeHolen) {
  const store = storeHolen?.();
  if (store) await Promise.allSettled([store.drainFlushes()]);
}

async function schliessenSobaldNichtsMehrLaeuft(eintrag) {
  await abwartenBisNichtsMehrLaeuft(eintrag.laufend, () => flushesAbwartenOhneFehlerFolge(eintrag.storeHolen));
  await eintrag.pg.close();
  eintrag.freigeben();
}

function aufraeumen(eintrag) {
  if (!eintrag.pg) return undefined;
  offene.delete(eintrag);
  if (!schliessVorgaenge.has(eintrag)) {
    schliessVorgaenge.set(eintrag, schliessenSobaldNichtsMehrLaeuft(eintrag));
  }
  return schliessVorgaenge.get(eintrag);
}

export function aufraeumenVormerken(storeHolen) {
  const eintrag = {
    pg: null,
    laufend: new Set(),
    storeHolen,
    freigeben() {
      eintrag.pg = null;
      eintrag.storeHolen = null;
    },
  };
  after(() => aufraeumen(eintrag));
  return async (abbild) => {
    const beginn = performance.now();
    try {
      eintrag.pg = await PGlite.create({ loadDataDir: abbild });
    } finally {
      datenbankStarts.zaehle(performance.now() - beginn);
    }
    offene.add(eintrag);
    return abfragenZaehlendeHuelle(eintrag.pg, eintrag.laufend);
  };
}

export function neuePglite() {
  return aufraeumenVormerken()(LEERE_VORLAGE);
}

after(() => Promise.all([...offene].map(aufraeumen)));
