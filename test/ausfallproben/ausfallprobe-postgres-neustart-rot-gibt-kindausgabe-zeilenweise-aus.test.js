import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERZUG_UEBER_ANFRAGEFRIST_MS = 6000;
const PRAEFIX = "kind> ";
const VORLAUF_ZEILEN = Array.from(
  { length: 30 },
  (_, i) => `vorlauf-${String(i + 1).padStart(2, "0")}`,
);
const OHNE_POSTGRES = `kein Postgres, uebersprungen (${POSTGRES_VARIABLE} fehlt)`;

function legeVorlaufAn() {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "kind-vorlauf-"));
  const datei = path.join(verzeichnis, "vorlauf.cjs");
  fs.writeFileSync(
    datei,
    `process.stderr.write(${JSON.stringify(`${VORLAUF_ZEILEN.join("\n")}\n`)});\n`,
  );
  return datei;
}

function fuehreAusRot() {
  const vorlauf = legeVorlaufAn();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/ausfallproben.mjs", "postgres-neustart"],
      {
        cwd: ROOT,
        env: kindUmgebung({
          [POSTGRES_VARIABLE]: process.env[POSTGRES_VARIABLE],
          NODE_OPTIONS: `--require ${vorlauf}`,
          AUSFALLPROBE_MESSWEICHE_VERZUG_MS: String(VERZUG_UEBER_ANFRAGEFRIST_MS),
        }),
      },
      (fehler, stdout, stderr) => {
        const zeilen = stdout.trim().split("\n").filter(Boolean);
        const zeile = JSON.parse(zeilen.pop());
        resolve({ code: fehler ? fehler.code : 0, stdout, stderr, zeile });
      },
    );
  });
}

let rotLauf = null;
const rot = () => (rotLauf ??= fuehreAusRot());

test("postgres-neustart rot: jede Zeile der Kind-Ausgabe steht als eigene stderr-Zeile mit Praefix", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { code, stderr, zeile } = await rot();
  assert.equal(code, 1);
  const beleg = zeile.beleg.kindAusgabe.split("\n");
  const ausgegeben = stderr
    .split("\n")
    .filter((eintrag) => eintrag.startsWith(PRAEFIX))
    .map((eintrag) => eintrag.slice(PRAEFIX.length));
  assert.ok(ausgegeben.length >= beleg.length);
  assert.deepEqual(ausgegeben.slice(-beleg.length), beleg);
});

test("postgres-neustart rot: auch die Zeilen vor den letzten 20 der Kind-Ausgabe erscheinen vollstaendig", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { stderr } = await rot();
  const ausgegeben = stderr
    .split("\n")
    .filter((eintrag) => eintrag.startsWith(PRAEFIX))
    .map((eintrag) => eintrag.slice(PRAEFIX.length));
  assert.deepEqual(ausgegeben.slice(0, VORLAUF_ZEILEN.length), VORLAUF_ZEILEN);
  assert.ok(ausgegeben.length > VORLAUF_ZEILEN.length);
});

test("postgres-neustart rot: die JSON-Zeile bleibt auf stdout, die Kind-Ausgabe erreicht stdout nicht zusaetzlich", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { stdout, zeile } = await rot();
  assert.equal(zeile.probe, "postgres-neustart");
  assert.equal(zeile.ergebnis, "rot");
  assert.equal(Object.hasOwn(zeile, "kindAusgabeVoll"), false);
  assert.equal(stdout.includes(PRAEFIX), false);
});

test("postgres-neustart rot: die Postgres-Adresse der aufrufenden Umgebung erreicht stderr nicht", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { stderr } = await rot();
  assert.equal(stderr.includes(process.env[POSTGRES_VARIABLE]), false);
});
