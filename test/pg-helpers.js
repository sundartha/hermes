import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makePgStore, BOOTSTRAP_TENANT_ID, anrufpauseSetzen } from "../src/store/pg.js";
import { applySchema } from "../src/db/migrate.js";
import { aufraeumenVormerken, vorlage } from "./pglite-helfer.js";

const SCHEMA_DATEI = new URL("../src/db/schema.sql", import.meta.url);
const MIGRATE_DATEI = new URL("../src/db/migrate.js", import.meta.url);
const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const RELATIVER_IMPORT = /\b(?:from|import)\s*["'](\.\.?\/[^"']+)["']/g;

export function vorlagenKette() {
  const kette = new Set([MIGRATE_DATEI.href]);
  for (const adresse of kette) {
    const inhalt = fs.readFileSync(new URL(adresse), "utf8");
    for (const [, ziel] of inhalt.matchAll(RELATIVER_IMPORT)) {
      kette.add(new URL(ziel, adresse).href);
    }
  }
  return [...kette].map((adresse) => path.relative(WURZEL, fileURLToPath(adresse))).sort();
}

let schemaVorlage = null;
function schemaVorlageHolen() {
  schemaVorlage ??= vorlage("schema", applySchema, [
    fs.readFileSync(SCHEMA_DATEI, "utf8"),
    fs.readFileSync(MIGRATE_DATEI, "utf8"),
  ]);
  return schemaVorlage;
}

export async function makePgTestStore() {
  let store = null;
  const anlegen = aufraeumenVormerken(() => store);
  const db = await anlegen(await schemaVorlageHolen());
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  store = makePgStore(runner);
  store.setzeAnrufpause = (an) => anrufpauseSetzen(store, an);
  await store.init();
  return { store, db, runner };
}

export { BOOTSTRAP_TENANT_ID };
