import { after } from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const VORLAGEN_ORDNER = path.join(os.tmpdir(), "hermes-pglite-vorlagen");
const PGLITE_PAKET = new URL("../node_modules/@electric-sql/pglite/package.json", import.meta.url);
const STRYKER_VARIABLE = "__STRYKER_ACTIVE_MUTANT__";

const offene = new Set();
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
  if (process.env[STRYKER_VARIABLE] !== undefined) return abbildBauen(einrichten);
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

function eineRundeDerEreignisschleife() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function abfragenZaehlendeHuelle(pg, laufend) {
  const mitzaehlen = (versprechen) => {
    laufend.add(versprechen);
    const austragen = () => laufend.delete(versprechen);
    versprechen.then(austragen, austragen);
    return versprechen;
  };
  const gezaehlt = {
    query: (text, params) => mitzaehlen(pg.query(text, params)),
    exec: (sql) => mitzaehlen(pg.exec(sql)),
  };
  return new Proxy(pg, {
    get(ziel, name) {
      if (Object.hasOwn(gezaehlt, name)) return gezaehlt[name];
      const wert = Reflect.get(ziel, name, ziel);
      return typeof wert === "function" ? wert.bind(ziel) : wert;
    },
  });
}

async function flushesAbwartenOhneFehlerFolge(storeHolen) {
  const store = storeHolen?.();
  if (store) await Promise.allSettled([store.drainFlushes()]);
}

async function schliessenSobaldNichtsMehrLaeuft(eintrag) {
  do {
    await flushesAbwartenOhneFehlerFolge(eintrag.storeHolen);
    await Promise.allSettled([...eintrag.laufend]);
    await eineRundeDerEreignisschleife();
  } while (eintrag.laufend.size > 0);
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
    eintrag.pg = await PGlite.create({ loadDataDir: abbild });
    offene.add(eintrag);
    return abfragenZaehlendeHuelle(eintrag.pg, eintrag.laufend);
  };
}

let geteilteDatenbank = null;
export function neuePglite() {
  geteilteDatenbank ??= PGlite.create({ loadDataDir: LEERE_VORLAGE });
  return geteilteDatenbank;
}

after(async () => {
  await Promise.all([...offene].map(aufraeumen));
  if (geteilteDatenbank) await (await geteilteDatenbank).close();
});
