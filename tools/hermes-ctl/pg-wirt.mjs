import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

import { ERSTES_ARGUMENT } from "./sitzung.mjs";
import { startbestandAnlegen } from "./startbestand.mjs";

const HOST = "127.0.0.1";
const FREIER_PORT = 0;
const ELTERN_TAKT_MS = 1000;
const ROLLE_OHNE_SUPERUSER_UND_BYPASSRLS_ANNEHMEN = `CREATE ROLE hermes_ctl_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  GRANT CREATE ON SCHEMA public TO hermes_ctl_app;
  SET ROLE hermes_ctl_app;`;

const [wirt, verbindungen, vorname, nachname] = process.argv.slice(ERSTES_ARGUMENT);
const maxConnections = Number(verbindungen);
setInterval(() => {
  if (process.ppid !== Number(wirt)) process.exit(0);
}, ELTERN_TAKT_MS);
const datenbank = await PGlite.create();
await datenbank.exec(ROLLE_OHNE_SUPERUSER_UND_BYPASSRLS_ANNEHMEN);
await startbestandAnlegen(datenbank, { vorname, nachname });
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
