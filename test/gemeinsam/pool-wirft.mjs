import pg from "pg";

pg.Pool = class WerfenderPool {
  constructor() {
    if (process.env.POOL_FEHLER === "text") throw "nur-text";
    throw new Error("mit-meldung");
  }
};
