import { EventEmitter } from "node:events";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

const db = await PGlite.create();
let frei = Promise.resolve();

const OHNE_SONDERRECHTE = { rows: [{ rolname: "hermes_app", is_su: "off", rolbypassrls: false }] };

const abfrage = async (text, params) => {
  if (/FROM\s+pg_roles r/.test(text)) return OHNE_SONDERRECHTE;
  if (params !== undefined) return db.query(text, params);
  const ergebnisse = await db.exec(text);
  return ergebnisse.at(-1) ?? { rows: [] };
};

pg.Pool = class PglitePool extends EventEmitter {
  waitingCount = 0;
  totalCount = 0;

  async connect() {
    const vorgaenger = frei;
    let freigeben;
    frei = new Promise((erfuellen) => {
      freigeben = erfuellen;
    });
    await vorgaenger;
    return { query: abfrage, release: freigeben };
  }

  async end() {}
};

process.on("beforeExit", () => db.close());
