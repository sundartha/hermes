import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const WERKZEUG_ORDNER = join(REPO, "tools", "hermes-ctl");
const PG_WIRT = join(WERKZEUG_ORDNER, "pg-wirt.mjs");
const PG_URL_ZEILE = /PG_URL=(\S+)/;
const VERBINDUNGEN = "4";
const TEST_FRIST_MS = 90000;
const VORNAME = "Jonas";
const NACHNAME = "Beispiel";
const EIGENTUEMER = "owner";

const IMPORT_AUS_SRC = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'][^"']*\/src\//;

function dateien() {
  return readdirSync(WERKZEUG_ORDNER, { recursive: true })
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => join(WERKZEUG_ORDNER, name));
}

function pgWirtStarten() {
  const kind = spawn(
    process.execPath,
    [PG_WIRT, String(process.pid), VERBINDUNGEN, VORNAME, NACHNAME],
    { env: { NODE_ENV: "test" }, stdio: ["ignore", "pipe", "inherit"] },
  );
  const url = new Promise((bereit, gescheitert) => {
    let ausgabe = "";
    kind.stdout.on("data", (stueck) => {
      ausgabe += stueck;
      const treffer = ausgabe.match(PG_URL_ZEILE);
      if (treffer === null) return;
      bereit(treffer[1]);
    });
    kind.once("exit", (code) => gescheitert(new Error(`PGlite-Wirt endete mit Code ${code}`)));
  });
  return { kind, url };
}

test("hermes-ctl importiert nichts aus src/", () => {
  const treffer = dateien().filter((datei) => IMPORT_AUS_SRC.test(readFileSync(datei, "utf8")));
  assert.deepEqual(treffer, []);
});

test("der Datenbank-Wirt legt den Eigentümer mit Vor- und Nachname selbst an", { timeout: TEST_FRIST_MS }, async () => {
  const { kind, url } = pgWirtStarten();
  const klient = new pg.Client({ connectionString: await url.catch((fehler) => assert.fail(fehler.message)) });
  try {
    await klient.connect();
    const { rows } = await klient.query("SELECT id, owner_name, first_name FROM tenant");
    assert.deepEqual(rows, [{ id: EIGENTUEMER, owner_name: `${VORNAME} ${NACHNAME}`, first_name: VORNAME }]);
  } finally {
    await klient.end().catch(() => undefined);
    kind.kill("SIGTERM");
  }
});
