import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_LAST_NAME,
  TELNYX_TEST_OWNER_NUMBER,
  anthropicAttrappe,
  startServer,
} from "../../test/helpers.js";
import { attrappenStarten } from "./attrappen.mjs";
import {
  ERSTES_ARGUMENT,
  EXIT_FEHLER,
  FEHLER_DATEI,
  KENNUNG_PG_WIRT,
  KENNUNG_SERVER,
  KENNUNG_WIRT,
  ROLLE_WIRT,
  SERVER_PROTOKOLL,
  WIRT_PROTOKOLL,
  ZUSTAND_DATEI,
  jsonSchreiben,
  kindBeendet,
} from "./sitzung.mjs";
import { hermesUmgebung, poolgroesseHermes, schluesselErzeugen } from "./umgebung.mjs";

const PG_WIRT = fileURLToPath(new URL("./pg-wirt.mjs", import.meta.url));
const PG_URL_ZEILE = /PG_URL=(\S+)/;
const PG_START_FRIST_MS = 60000;
const ORDNER_TAKT_MS = 1000;

const ordner = process.argv[ERSTES_ARGUMENT];
const sitzung = basename(ordner);
const laufend = { attrappen: null, pg: null, server: null, start: null, endet: false };

function pgWirtStarten(maxConnections) {
  const startbestand = [TELNYX_TEST_OWNER_NUMBER.e164, OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME];
  const argumente = [String(process.pid), String(maxConnections), ...startbestand];
  const kind = spawn(process.execPath, [PG_WIRT, ...argumente], {
    env: { NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  laufend.pg = kind;
  return new Promise((bereit, gescheitert) => {
    let ausgabe = "";
    const frist = setTimeout(
      () => gescheitert(new Error("PGlite ist nicht rechtzeitig bereit")),
      PG_START_FRIST_MS,
    );
    kind.stdout.on("data", (stueck) => {
      ausgabe += stueck;
      const treffer = ausgabe.match(PG_URL_ZEILE);
      if (treffer === null) return;
      clearTimeout(frist);
      bereit(treffer[1]);
    });
    kind.once("exit", (code) => {
      clearTimeout(frist);
      gescheitert(new Error(`PGlite-Wirt endete beim Start mit Code ${code}`));
    });
  });
}

async function kindBeenden(kind) {
  if (kind === null || kindBeendet(kind)) return;
  const ende = once(kind, "exit");
  kind.kill("SIGTERM");
  await ende;
}

function protokollMitschreiben(server, datei) {
  writeFileSync(datei, server.stdout);
  const anhaengen = (stueck) => appendFileSync(datei, stueck);
  server.child.stdout.on("data", anhaengen);
  server.child.stderr.on("data", anhaengen);
}

function prozessListe(pgPid, serverPid) {
  return [
    { rolle: ROLLE_WIRT, pid: process.pid, kennung: KENNUNG_WIRT },
    { rolle: "pg-wirt", pid: pgPid, kennung: KENNUNG_PG_WIRT },
    { rolle: "hermes", pid: serverPid, kennung: KENNUNG_SERVER },
  ];
}

function zustandSchreiben({ schluessel, urls, pgUrl, server }) {
  jsonSchreiben(join(ordner, ZUSTAND_DATEI), {
    sitzung,
    url: server.localUrl,
    ports: { hermes: server.port, pg: Number(new URL(pgUrl).port) },
    attrappen: urls,
    prozesse: prozessListe(laufend.pg.pid, server.child.pid),
    token: {
      werkzeug: schluessel.werkzeugToken,
      init: schluessel.initToken,
      status: schluessel.statusToken,
    },
    telnyxPrivatPem: schluessel.telnyxPrivatPem,
    protokolle: { hermes: join(ordner, SERVER_PROTOKOLL), wirt: join(ordner, WIRT_PROTOKOLL) },
    gestartet: new Date().toISOString(),
  });
}

async function starten() {
  const schluessel = schluesselErzeugen();
  laufend.attrappen = await attrappenStarten();
  if (laufend.endet) return;
  const urls = { ...laufend.attrappen.urls, anthropic: anthropicAttrappe.url };
  const pgUrl = await pgWirtStarten(await poolgroesseHermes());
  if (laufend.endet) return;
  const umgebung = hermesUmgebung({ schluessel, urls, pgUrl });
  laufend.server = await startServer({
    env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ...umgebung },
    ownerNumber: null,
  });
  if (laufend.endet) return;
  protokollMitschreiben(laufend.server, join(ordner, SERVER_PROTOKOLL));
  zustandSchreiben({ schluessel, urls, pgUrl, server: laufend.server });
}

async function beenden(code) {
  if (laufend.endet) return;
  laufend.endet = true;
  await laufend.start?.catch(() => undefined);
  if (laufend.server !== null) {
    await laufend.server.stop().catch(() => undefined);
    rmSync(laufend.server.dataDir, { recursive: true, force: true });
  }
  await kindBeenden(laufend.pg);
  await laufend.attrappen?.schliessen();
  process.exit(code);
}

process.on("SIGTERM", () => void beenden(0));
process.on("SIGINT", () => void beenden(0));

function ohneZustandsdateiBeenden() {
  setInterval(() => {
    if (!existsSync(join(ordner, ZUSTAND_DATEI))) void beenden(0);
  }, ORDNER_TAKT_MS);
}

try {
  laufend.start = starten();
  await laufend.start;
  ohneZustandsdateiBeenden();
} catch (fehler) {
  jsonSchreiben(join(ordner, FEHLER_DATEI), { fehler: fehler.message });
  await beenden(EXIT_FEHLER);
}
