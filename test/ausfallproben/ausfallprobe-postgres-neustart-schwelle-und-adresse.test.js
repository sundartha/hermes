import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { lokaleDatenbank } from "../../scripts/ausfallproben/datenbank.mjs";
import { warteAufWiederkehr } from "../../scripts/ausfallproben/proben/postgres-neustart.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHWELLE = { wiederBereitMs: 30_000, messTaktMs: 500 };
const LEBT = { prozess: { exitCode: null } };

function uhr() {
  let jetzt = 0;
  return {
    jetzt: () => jetzt,
    pause: async (ms) => void (jetzt += ms),
    vor: (ms) => void (jetzt += ms),
  };
}

function messeMit(u, { ab, dauerMs }) {
  return async () => {
    const beginn = u.jetzt();
    u.vor(dauerMs);
    return { status: beginn >= ab ? 200 : 503 };
  };
}

test("postgres-neustart: eine 200-Antwort, die erst nach 30 s ankommt, zaehlt nicht als gruen", async () => {
  const u = uhr();
  const gemessen = await warteAufWiederkehr(LEBT, "x", {
    schwelle: SCHWELLE,
    messe: messeMit(u, { ab: 25_000, dauerMs: 4900 }),
    jetzt: u.jetzt,
    pause: u.pause,
  });
  assert.equal(gemessen, null);
});

test("postgres-neustart: eine 200-Antwort genau bei 30 s zaehlt noch als gruen", async () => {
  const u = uhr();
  const gemessen = await warteAufWiederkehr(LEBT, "x", {
    schwelle: SCHWELLE,
    messe: async () => {
      u.vor(30_000);
      return { status: 200 };
    },
    jetzt: u.jetzt,
    pause: u.pause,
  });
  assert.equal(gemessen, 30_000);
});

test("postgres-neustart: eine rechtzeitige 200-Antwort liefert die gemessene Zeit", async () => {
  const u = uhr();
  const gemessen = await warteAufWiederkehr(LEBT, "x", {
    schwelle: SCHWELLE,
    messe: messeMit(u, { ab: 2000, dauerMs: 100 }),
    jetzt: u.jetzt,
    pause: u.pause,
  });
  assert.equal(gemessen, 2500);
});

test("postgres-neustart: eine Postgres-Adresse mit Abfrageteil gilt nicht als lokal", () => {
  assert.equal(lokaleDatenbank("postgres://u@127.0.0.1:5432/postgres?host=db.example.com"), null);
  assert.equal(lokaleDatenbank("postgres://u@localhost:5432/postgres?sslmode=disable"), null);
  assert.equal(lokaleDatenbank("postgres://u@127.0.0.1:5432/postgres")?.hostname, "127.0.0.1");
});

test("postgres-neustart: ein ?host= in der Postgres-Adresse ist rot, ohne dorthin zu verbinden", async () => {
  const lauf = await new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/ausfallproben.mjs", "postgres-neustart"],
      {
        cwd: ROOT,
        env: kindUmgebung({
          [POSTGRES_VARIABLE]: "postgres://u@127.0.0.1:5432/postgres?host=192.0.2.1",
        }),
      },
      (fehler, stdout) =>
        resolve({
          code: fehler ? fehler.code : 0,
          zeile: JSON.parse(stdout.trim().split("\n").pop()),
        }),
    );
  });
  assert.equal(lauf.code, 1);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "Postgres ist nicht lokal (nur 127.0.0.1 oder localhost)");
});
