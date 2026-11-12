import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { BASE_ENV, tempDataDir } from "../helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOOPBACK = "127.0.0.1";
const KIND_SKRIPT = [
  'import { oeffneSpeicher } from "./src/store.js";',
  'import * as speicher from "./src/store.js";',
  "await oeffneSpeicher();",
  "await speicher.pruefeVerbindung();",
  'console.log("bereit");',
  "await new Promise((weiter) => process.stdin.once('data', weiter));",
  "const ergebnis = await speicher.pruefeVerbindung().then(() => 'ok', () => 'abgelehnt');",
  "console.log('ergebnis:' + ergebnis);",
  "process.exit(0);",
].join("\n");

function startProxy(ziel) {
  const zustand = { gekappt: false, sockets: new Set() };
  const server = net.createServer((aussen) => {
    const innen = net.connect(ziel.port, ziel.hostname);
    for (const socket of [aussen, innen]) {
      zustand.sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => zustand.sockets.delete(socket));
    }
    aussen.on("data", (stueck) => {
      if (zustand.gekappt) return void [aussen, innen].forEach((socket) => socket.destroy());
      innen.write(stueck);
    });
    innen.pipe(aussen);
  });
  return new Promise((resolve) =>
    server.listen(0, LOOPBACK, () => resolve({ server, zustand, port: server.address().port })),
  );
}

function starteKind(datenbankUrl) {
  const kind = spawn(process.execPath, ["--input-type=module", "-e", KIND_SKRIPT], {
    cwd: ROOT,
    env: kindUmgebung({
      ...BASE_ENV,
      STORE_BACKEND: "pg",
      DATABASE_URL: datenbankUrl,
      DATA_DIR: tempDataDir(),
    }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const ausgabe = { stdout: "", stderr: "" };
  kind.stdout.on("data", (stueck) => (ausgabe.stdout += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe.stderr += stueck));
  const ende = new Promise((resolve) => kind.once("close", (code) => resolve(code)));
  const bereit = new Promise((resolve) => {
    const pruefe = () => ausgabe.stdout.includes("bereit") && resolve();
    kind.stdout.on("data", pruefe);
    ende.then(resolve);
  });
  return { kind, ausgabe, ende, bereit };
}

test("Verbindungsverlust waehrend einer Datenbankabfrage meldet den Verlust und laesst Hermes gesund", async (t) => {
  const datenbank = await echteDatenbank(t);
  if (!datenbank) return;
  const ziel = new URL(datenbank.adresse);
  const proxy = await startProxy(ziel);
  t.after(() => {
    for (const socket of proxy.zustand.sockets) socket.destroy();
    proxy.server.close();
  });
  const proxyUrl = new URL(ziel);
  proxyUrl.hostname = LOOPBACK;
  proxyUrl.port = String(proxy.port);
  const { kind, ausgabe, ende, bereit } = starteKind(proxyUrl.href);
  await bereit;
  assert.match(ausgabe.stdout, /bereit/, ausgabe.stderr);
  proxy.zustand.gekappt = true;
  kind.stdin.write("weiter\n");
  const code = await ende;
  assert.equal(code, 0, ausgabe.stderr);
  assert.match(ausgabe.stdout, /ergebnis:abgelehnt/);
  assert.match(ausgabe.stderr, /\[pool:haupt\] Verbindungsfehler: /);
  assert.doesNotMatch(ausgabe.stderr, /uncaughtException/);
});
