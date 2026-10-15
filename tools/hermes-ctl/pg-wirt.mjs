import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

import { ERSTES_ARGUMENT } from "./sitzung.mjs";
import { startbestandAnlegen } from "./startbestand.mjs";

const HOST = "127.0.0.1";
const FREIER_PORT = 0;
const ELTERN_TAKT_MS = 1000;

const [wirt, verbindungen, nummer, vorname, nachname] = process.argv.slice(ERSTES_ARGUMENT);
const maxConnections = Number(verbindungen);
setInterval(() => {
  if (process.ppid !== Number(wirt)) process.exit(0);
}, ELTERN_TAKT_MS);
const datenbank = await PGlite.create();
await startbestandAnlegen(datenbank, { nummer, vorname, nachname });
const socket = new PGLiteSocketServer({
  db: datenbank,
  host: HOST,
  port: FREIER_PORT,
  maxConnections,
});
await socket.start();
const [, port] = socket.getServerConn().split(":");
console.log(`PG_URL=postgres://postgres:postgres@${HOST}:${port}/postgres?sslmode=disable`);

async function beenden() {
  await socket.stop().catch(() => undefined);
  await datenbank.close().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", beenden);
process.on("SIGINT", beenden);
