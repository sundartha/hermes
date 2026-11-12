import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { AUSFALLPROBE_MARKER } from "../gemeinsam/erfundene-geheimnisse.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHWELLE_MS = 2000;
const ANFRAGE_FRIST_MS = 5000;

function umgebungsNamen() {
  const text = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  return [...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((treffer) => treffer[1]);
}

function markerUmgebung() {
  return Object.fromEntries(umgebungsNamen().map((name) => [name, AUSFALLPROBE_MARKER]));
}

function fuehreAus(args, zusatz = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/ausfallproben.mjs", ...args],
      { cwd: ROOT, env: kindUmgebung({ ...markerUmgebung(), ...zusatz }) },
      (fehler, stdout, stderr) => {
        const zeilen = stdout.trim().split("\n").filter(Boolean);
        const zeile = zeilen.pop();
        resolve({
          code: fehler ? fehler.code : 0,
          stdout,
          stderr,
          zeile: zeile ? JSON.parse(zeile) : null,
        });
      },
    );
  });
}

let gruenerLauf = null;
const gruen = () => (gruenerLauf ??= fuehreAus(["elevenlabs-aus", "--ziel", "127.0.0.1"]));

test("elevenlabs-aus: Hermes bleibt bei Anbieter-Ausfall binnen 2000 ms auf /healthz 200, Exit 0", async () => {
  const lauf = await gruen();
  assert.equal(lauf.code, 0, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.probe, "elevenlabs-aus");
  assert.equal(lauf.zeile.ergebnis, "gruen");
  assert.equal(lauf.zeile.schwelle, SCHWELLE_MS);
  assert.ok(
    lauf.zeile.gemessen >= 0 && lauf.zeile.gemessen <= SCHWELLE_MS,
    `gemessen ${lauf.zeile.gemessen}`,
  );
  assert.ok(lauf.zeile.grund.length > 0);
});

test("elevenlabs-aus: gruen zaehlt nur, wenn die Weiche einen Anbieter-Aufruf abgelehnt hat", async () => {
  const lauf = await gruen();
  assert.ok(lauf.zeile.beleg.anbieterAufrufe >= 1);
});

test("elevenlabs-aus: /healthz hinter einer Verzoegerungsweiche ueber der Schwelle ist rot mit Grund, Exit 1", async () => {
  const lauf = await fuehreAus(["elevenlabs-aus"], {
    AUSFALLPROBE_MESSWEICHE_VERZUG_MS: String(SCHWELLE_MS + 500),
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "/healthz zu langsam");
  assert.ok(lauf.zeile.gemessen > SCHWELLE_MS, `gemessen ${lauf.zeile.gemessen}`);
});

test("elevenlabs-aus: keine Antwort von /healthz ist rot mit Grund, Exit 1", async () => {
  const lauf = await fuehreAus(["elevenlabs-aus"], {
    AUSFALLPROBE_MESSWEICHE_VERZUG_MS: String(ANFRAGE_FRIST_MS * 4),
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "Keine Antwort von /healthz");
  assert.equal(lauf.zeile.gemessen, null);
});

test("elevenlabs-aus: ohne gesehenen Anbieter-Aufruf ist die Probe rot, Exit 1", async () => {
  const lauf = await fuehreAus(["elevenlabs-aus"], { AUSFALLPROBE_OHNE_SAAT: "1" });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "Die Weiche sah keinen Anbieter-Aufruf");
});

test("Aufruf: Ziel ausser 127.0.0.1 bricht mit Exit 2 ab, ohne Probe und ohne Ergebnis", async () => {
  for (const ziel of ["192.0.2.1", "example.com:443", "0.0.0.0", ""]) {
    const lauf = await fuehreAus(["elevenlabs-aus", "--ziel", ziel]);
    assert.equal(lauf.code, 2, `Ziel ${ziel}: ${lauf.stdout}${lauf.stderr}`);
    assert.equal(lauf.stdout, "");
    assert.match(lauf.stderr, /Aufruf abgelehnt/);
  }
});

test("Aufruf: unbekannte Probe, fehlende Probe und fremde Angaben enden mit Exit 2", async () => {
  for (const args of [
    ["gibt-es-nicht"],
    [],
    ["elevenlabs-aus", "--ziel"],
    ["elevenlabs-aus", "--anders", "127.0.0.1"],
  ]) {
    const lauf = await fuehreAus(args);
    assert.equal(lauf.code, 2, `${args.join(" ")}: ${lauf.stdout}${lauf.stderr}`);
    assert.equal(lauf.stdout, "");
  }
});

test("Kindprozess: OUTBOUND_FROZEN true, erfundene Schluessel, kein Wert der aufrufenden Umgebung", async () => {
  const lauf = await gruen();
  const umgebung = lauf.zeile.beleg.umgebung;
  assert.equal(umgebung.OUTBOUND_FROZEN, "true");
  assert.equal(umgebung.STORE_BACKEND, "json");
  assert.equal(umgebung.ELEVENLABS_API_KEY, lauf.zeile.beleg.schluessel);
  assert.notEqual(umgebung.ELEVENLABS_API_KEY, AUSFALLPROBE_MARKER);
  assert.ok(
    !lauf.stdout.includes(AUSFALLPROBE_MARKER),
    "Marker darf nirgends in der Ausgabe stehen",
  );
  for (const [name, wert] of Object.entries(umgebung))
    assert.ok(!wert.includes(AUSFALLPROBE_MARKER), name);
});

test("Kindprozess: alle Anbieter-Adressen zeigen auf 127.0.0.1, Arbeitsverzeichnis ist ein Temp-Verzeichnis", async () => {
  const umgebung = (await gruen()).zeile.beleg.umgebung;
  const basen = [
    "ELEVENLABS_API_BASE",
    "TELNYX_API_BASE",
    "STRIPE_API_BASE",
    "WORKOS_API_BASE",
    "EXA_API_BASE",
    "ANTHROPIC_BASE_URL",
  ];
  for (const name of basen) assert.match(umgebung[name], /^http:\/\/127\.0\.0\.1:\d+$/, name);
  assert.match(umgebung.PUBLIC_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(umgebung.DATA_DIR.includes("ausfallprobe-"));
  assert.ok(!fs.existsSync(umgebung.DATA_DIR), "Temp-Verzeichnis wird aufgeraeumt");
});

test("Kindprozess bindet jeden Port-Server nur an 127.0.0.1, auch bei angegebener offener Adresse", async () => {
  const skript = [
    "const net = require('node:net');",
    "const a = net.createServer().listen(0, () => {",
    "  const b = net.createServer().listen(0, '0.0.0.0', () => {",
    "    console.log(JSON.stringify([a.address().address, b.address().address]));",
    "    process.exit(0);",
    "  });",
    "});",
  ].join("\n");
  const ausgabe = await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", path.join(ROOT, "scripts/ausfallproben/nur-loopback.mjs"), "-e", skript],
      { cwd: ROOT, env: kindUmgebung() },
      (fehler, stdout) => (fehler ? reject(fehler) : resolve(stdout)),
    );
  });
  assert.deepEqual(JSON.parse(ausgabe), ["127.0.0.1", "127.0.0.1"]);
});

test("Kindprozess laedt keine .env aus dem Repo: Code laeuft aus einer Kopie im Temp-Verzeichnis", async () => {
  const { starteKind, legeDatenVerzeichnisAn, raeumeDatenVerzeichnisAuf } =
    await import("../../scripts/ausfallproben/hermes-kind.mjs");
  const envDatei = path.join(ROOT, ".env");
  if (fs.existsSync(envDatei)) return;
  fs.writeFileSync(envDatei, `STRIPE_SECRET_KEY=${AUSFALLPROBE_MARKER}\n`);
  const datenVerzeichnis = legeDatenVerzeichnisAn();
  let kind;
  try {
    kind = await starteKind({ weicheUrl: "http://127.0.0.1:1", datenVerzeichnis });
    assert.ok(!kind.kopie.startsWith(ROOT), "Arbeitsverzeichnis liegt ausserhalb des Repos");
    assert.ok(!fs.existsSync(path.join(kind.kopie, ".env")));
    const ausgabe = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [
          "-e",
          "import('./src/config.js').then((m) => console.log(JSON.stringify(m.config.billing.stripeSecretKey ?? null)))",
        ],
        { cwd: kind.kopie, env: kindUmgebung({ NODE_ENV: "production" }) },
        (fehler, stdout) => resolve(stdout),
      );
    });
    assert.ok(!ausgabe.includes(AUSFALLPROBE_MARKER), `.env erreicht das Kind: ${ausgabe}`);
  } finally {
    fs.rmSync(envDatei, { force: true });
    if (kind) kind.prozess.kill("SIGKILL");
    raeumeDatenVerzeichnisAuf(datenVerzeichnis);
  }
});
