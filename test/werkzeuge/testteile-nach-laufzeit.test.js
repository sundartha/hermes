import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { dateienDesTeils, leseDauern, schneide } from "../../tools/testlaufzeit/teilung.mjs";
import { probeDirectory, REPO_ROOT } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/testlaufzeit/teil-dateien.mjs");
const MESSDATEI = "messung.json";
const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const EXIT_AUFRUF = 2;
const GEMESSEN = {
  "test/a.test.js": 900,
  "test/b.test.js": 800,
  "test/c.test.js": 300,
  "test/d.test.js": 300,
  "test/e.test.js": 200,
  "test/f.test.js": 100,
};
const DATEIEN = Object.keys(GEMESSEN);
const NEU = ["test/neu-1.test.js", "test/neu-2.test.js"];
const TEILE = 3;
const ERLAUBTE_ABWEICHUNG = 1.25;
const SCHWERE = [700, 650, 600, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5];

function messung(dauern) {
  return `${JSON.stringify({ dauern })}\n`;
}

function summe(teil, dauern) {
  return teil.reduce((gesamt, datei) => gesamt + dauern[datei], 0);
}

function vollstaendig(teile, dateien) {
  const alle = teile.flat();
  assert.equal(alle.length, new Set(alle).size, `Datei doppelt: ${alle.join(" ")}`);
  assert.deepEqual([...alle].sort(), [...new Set(dateien)].sort());
}

function messdatei(context, inhalt) {
  const ordner = probeDirectory(context, inhalt === undefined ? {} : { [MESSDATEI]: inhalt });
  return join(ordner, MESSDATEI);
}

const MESSDATEIEN = {
  "mit allen Messwerten": () => messung(GEMESSEN),
  "mit neuen Dateien ohne Messwert": () => messung(GEMESSEN),
  "mit leerer Tabelle": () => messung({}),
  "mit kaputter Datei": () => "{ kein json",
  "mit Tabelle statt Dauern": () => "[]\n",
  "mit ungültigen Werten": () => messung({ "test/a.test.js": "lang", "test/b.test.js": -5, "test/c.test.js": null }),
  "ohne Datei": () => undefined,
};

for (const [fall, inhalt] of Object.entries(MESSDATEIEN)) {
  test(`Testteile ${fall}: jede Datei läuft in genau einem Teil`, (context) => {
    const pfad = messdatei(context, inhalt());
    const dateien = fall.includes("neuen") ? [...DATEIEN, ...NEU] : DATEIEN;
    const teile = Array.from({ length: TEILE }, (_, index) => dateienDesTeils({ dateien, teil: index + 1, anzahl: TEILE, messdatei: pfad }).dateien);

    vollstaendig(teile, dateien);
  });
}

test("Testteile: eine doppelt gelieferte Datei läuft trotzdem nur einmal", () => {
  const { teile } = schneide([...DATEIEN, DATEIEN[0]], TEILE, new Map(Object.entries(GEMESSEN)));

  vollstaendig(teile, DATEIEN);
});

test("Testteile: die Dauern gleichen die Teile aus", () => {
  const { teile, rueckfall } = schneide(DATEIEN, TEILE, new Map(Object.entries(GEMESSEN)));

  assert.equal(rueckfall, null);
  assert.deepEqual(teile, [
    ["test/a.test.js"],
    ["test/b.test.js", "test/f.test.js"],
    ["test/c.test.js", "test/d.test.js", "test/e.test.js"],
  ]);
});

test("Testteile: viele kleine Dateien füllen die Lücken neben den schweren", () => {
  const dauern = Object.fromEntries(SCHWERE.map((ms, index) => [`test/s${index}.test.js`, ms]));
  const { teile } = schneide(Object.keys(dauern), TEILE, new Map(Object.entries(dauern)));
  const lasten = teile.map((teil) => summe(teil, dauern));
  const mittel = lasten.reduce((gesamt, last) => gesamt + last, 0) / TEILE;

  assert.ok(Math.max(...lasten) <= mittel * ERLAUBTE_ABWEICHUNG, lasten.join(" "));
});

test("Testteile: dieselben Dateien ergeben unabhängig von der Reihenfolge dieselben Teile", () => {
  const dauern = new Map(Object.entries(GEMESSEN));

  assert.deepEqual(schneide(DATEIEN, TEILE, dauern), schneide([...DATEIEN].reverse(), TEILE, dauern));
});

test("Testteile: eine neue Datei ohne Messwert zählt mit dem Median der gemessenen", () => {
  const dauern = new Map(Object.entries({ "test/gross.test.js": 300, "test/s1.test.js": 100, "test/s2.test.js": 100, "test/s3.test.js": 100 }));
  const { teile } = schneide([...dauern.keys(), "test/0-neu.test.js"], 2, dauern);

  assert.deepEqual(teile, [
    ["test/gross.test.js", "test/s3.test.js"],
    ["test/0-neu.test.js", "test/s1.test.js", "test/s2.test.js"],
  ]);
});

for (const [fall, inhalt] of [["fehlender", undefined], ["leerer", messung({})], ["kaputter", "{ kein json"]]) {
  test(`Testteile: bei ${fall} Messdatei gilt der Schnitt reihum und der Hinweis nennt es`, (context) => {
    const pfad = messdatei(context, inhalt);
    const sortiert = [...DATEIEN].sort();
    const ergebnis = Array.from({ length: TEILE }, (_, index) => dateienDesTeils({ dateien: DATEIEN, teil: index + 1, anzahl: TEILE, messdatei: pfad }));

    assert.deepEqual(
      ergebnis.map(({ dateien }) => dateien),
      Array.from({ length: TEILE }, (_, teil) => sortiert.filter((_datei, index) => index % TEILE === teil)),
    );
    assert.ok(ergebnis.every(({ rueckfall }) => typeof rueckfall === "string" && rueckfall.includes(MESSDATEI)));
  });
}

test("Testteile: Messwerte nur für andere Dateien ergeben den Schnitt reihum", () => {
  const { teile, rueckfall } = schneide(NEU, 2, new Map([["test/a.test.js", 5]]));

  assert.deepEqual(teile, [[NEU[0]], [NEU[1]]]);
  assert.match(rueckfall, /Messwerte/);
});

test("Testteile: leseDauern übernimmt nur gültige Dauern", (context) => {
  const { dauern, grund } = leseDauern(messdatei(context, messung({ "test/a.test.js": 5, "test/b.test.js": "x", "test/c.test.js": -1 })));

  assert.equal(grund, null);
  assert.deepEqual([...dauern], [["test/a.test.js", 5]]);
});

function werkzeug(context, argumente, dateien) {
  const ordner = probeDirectory(context, { [MESSDATEI]: messung(GEMESSEN), ...Object.fromEntries(dateien.map((datei) => [datei, ""])) });
  return spawnSync(process.execPath, [TOOL, ...argumente], { cwd: ordner, encoding: "utf8" });
}

test("Testteile: das Werkzeug liefert über alle Teile jede Datei genau einmal und schließt Werkzeugtests auf Wunsch aus", (context) => {
  const dateien = ["test/a.test.js", "test/b.test.js", "test/c.test.js", "test/werkzeuge/w.test.js"];
  const lauf = (teil, extra) => werkzeug(context, ["--teil", String(teil), "--teile", "2", "--messdatei", MESSDATEI, ...extra], dateien);
  const zeilen = (extra) => [1, 2].map((teil) => lauf(teil, extra).stdout.split("\n").filter((zeile) => zeile !== ""));

  vollstaendig(zeilen([]), dateien);
  vollstaendig(zeilen(["--ohne-werkzeugtests"]), dateien.slice(0, 3));
});

test("Testteile: das Werkzeug meldet den Rückfall und liefert nie einen leeren Teil", (context) => {
  const eine = werkzeug(context, ["--teil", "1", "--teile", "1", "--messdatei", "fehlt.json"], ["test/a.test.js"]);
  const leer = werkzeug(context, ["--teil", "2", "--teile", "2", "--messdatei", MESSDATEI], ["test/a.test.js"]);
  const falsch = werkzeug(context, ["--teil", "3", "--teile", "2"], ["test/a.test.js"]);

  assert.equal(eine.status, EXIT_OK);
  assert.equal(eine.stdout.trim(), "test/a.test.js");
  assert.match(eine.stderr, /reihum statt nach Laufzeit/);
  assert.equal(leer.status, EXIT_FEHLER);
  assert.equal(leer.stdout, "");
  assert.equal(falsch.status, EXIT_AUFRUF);
});
