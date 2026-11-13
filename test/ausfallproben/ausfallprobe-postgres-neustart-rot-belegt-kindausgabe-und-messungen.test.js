import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERZUG_UEBER_ANFRAGEFRIST_MS = 6000;
const LETZTE_ZEILEN = 20;
const OHNE_POSTGRES = `kein Postgres, uebersprungen (${POSTGRES_VARIABLE} fehlt)`;

function fuehreAusRot() {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/ausfallproben.mjs", "postgres-neustart"],
      {
        cwd: ROOT,
        env: kindUmgebung({
          [POSTGRES_VARIABLE]: process.env[POSTGRES_VARIABLE],
          AUSFALLPROBE_MESSWEICHE_VERZUG_MS: String(VERZUG_UEBER_ANFRAGEFRIST_MS),
        }),
      },
      (fehler, stdout) => {
        const zeilen = stdout.trim().split("\n").filter(Boolean);
        const zeile = zeilen.pop();
        resolve({ code: fehler ? fehler.code : 0, stdout, zeile: JSON.parse(zeile) });
      },
    );
  });
}

let rotLauf = null;
const rot = () => (rotLauf ??= fuehreAusRot());

test("postgres-neustart rot: der Beleg nennt die Ausgabe des Hermes-Kindes, nur die letzten 20 Zeilen", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { zeile } = await rot();
  assert.equal(zeile.grund, "/healthz kam nach dem Neustart nicht zurueck");
  const { kindAusgabe } = zeile.beleg;
  assert.equal(typeof kindAusgabe, "string");
  assert.ok(kindAusgabe.length > 0);
  assert.ok(kindAusgabe.split("\n").length <= LETZTE_ZEILEN);
});

test("postgres-neustart rot: der Beleg zaehlt die /healthz-Messungen und nennt keine Wiederkehr", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { zeile } = await rot();
  assert.ok(Number.isInteger(zeile.beleg.messungen));
  assert.ok(zeile.beleg.messungen >= 1);
  assert.equal(zeile.beleg.wiederbereitNachStoerungMs, null);
  const { letzteAntwort } = zeile.beleg;
  assert.equal(letzteAntwort.status, null);
});

test("postgres-neustart rot: die Postgres-Adresse der aufrufenden Umgebung erreicht die Zeile nicht", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await rot();
  assert.equal(lauf.stdout.includes(process.env[POSTGRES_VARIABLE]), false);
});

const ZEILEN_EINGABE = 25;
const nummeriert = (anzahl) =>
  Array.from({ length: anzahl }, (_, i) => `zeile ${i + 1}`).join("\n");

test("Kind-Ausgabe im Beleg: bei 25 Zeilen bleiben genau die letzten 20", async () => {
  const { letzteZeilen } = await import("../../scripts/ausfallproben/proben/postgres-neustart.mjs");
  const ergebnis = letzteZeilen(`${nummeriert(ZEILEN_EINGABE)}\n`).split("\n");
  assert.equal(ergebnis.length, LETZTE_ZEILEN);
  assert.equal(ergebnis[0], "zeile 6");
  assert.equal(ergebnis[LETZTE_ZEILEN - 1], "zeile 25");
});

test("Kind-Ausgabe im Beleg: bei genau 20 Zeilen bleibt alles", async () => {
  const { letzteZeilen } = await import("../../scripts/ausfallproben/proben/postgres-neustart.mjs");
  assert.equal(letzteZeilen(nummeriert(LETZTE_ZEILEN)), nummeriert(LETZTE_ZEILEN));
});
