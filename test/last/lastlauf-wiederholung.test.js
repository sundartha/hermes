import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { baueErgebnis } from "../../scripts/last/ergebnis.js";
import { fuehreLastlaufAus } from "../../scripts/last/lauf.mjs";
import { nurFehlerquoteUeberGrenze } from "../../scripts/last/schwellen.mjs";

const SKRIPT = [
  'const fs = require("node:fs");',
  "const werte = Object.fromEntries(process.argv.flatMap((a, i) => (process.argv[i - 1] === \"-e\" ? [a.split(/=(.*)/s).slice(0, 2)] : [])));",
  'const konfig = JSON.parse(fs.readFileSync(werte.LAST_KONFIG, "utf8"));',
  'const n = fs.existsSync(konfig.zaehler) ? Number(fs.readFileSync(konfig.zaehler, "utf8")) : 0;',
  "fs.writeFileSync(konfig.zaehler, String(n + 1));",
  "fs.writeFileSync(werte.LAST_ERGEBNIS, JSON.stringify(konfig.ergebnisse[Math.min(n, konfig.ergebnisse.length - 1)]));",
].join("\n");

const LOKAL = ["http://localhost:3999"];
const gut = (werte = {}) => ({ fehlerquoteProzent: 0.2, verloreneAnrufe: 0, wartezeitSekunden: 1, routen: [{ name: "r", istMs: 1, budgetMs: 2 }], ...werte });

async function lauf(ergebnisse) {
  const ordner = await mkdtemp(join(tmpdir(), "hermes-wiederholung-"));
  const zaehler = join(ordner, "zaehler");
  const stand = { geschlossen: 0, gestartet: 0 };
  const starte = async () => {
    stand.gestartet += 1;
    return { ziele: LOKAL, konfiguration: { zaehler, ergebnisse }, schliessen: async () => void (stand.geschlossen += 1) };
  };
  try {
    const ergebnis = await fuehreLastlaufAus({ k6Befehl: [process.execPath, "-e", SKRIPT], starte });
    const laeufe = Number(await readFile(zaehler, "utf8"));
    return { ...ergebnis, laeufe, stand };
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

const FAELLE = [
  ["Quote 0,6 dann 0,4: genau eine Wiederholung, Job gruen", [gut({ fehlerquoteProzent: 0.6 }), gut({ fehlerquoteProzent: 0.4 })], 2, true, []],
  ["Quote 0,6 dann 0,5: Wiederholung bleibt an der Grenze rot", [gut({ fehlerquoteProzent: 0.6 }), gut({ fehlerquoteProzent: 0.5 })], 2, false, ["fehlerquote"]],
  ["Quote 0,6 dann 0,7: rot", [gut({ fehlerquoteProzent: 0.6 }), gut({ fehlerquoteProzent: 0.7 })], 2, false, ["fehlerquote"]],
  [
    "Quote 0,6 dann weitere Verstoesse: rot, keine dritte Messung",
    [gut({ fehlerquoteProzent: 0.6 }), gut({ fehlerquoteProzent: 0.9, verloreneAnrufe: 1 }), gut()],
    2,
    false,
    ["fehlerquote", "verlorene_anrufe"],
  ],
  ["Quote 0,6 dann 0,6, ein dritter gruener waere vorhanden: rot nach zwei Laeufen", [gut({ fehlerquoteProzent: 0.6 }), gut({ fehlerquoteProzent: 0.6 }), gut()], 2, false, ["fehlerquote"]],
  ["Quote 0,2: keine Wiederholung", [gut(), gut({ fehlerquoteProzent: 9 })], 1, true, []],
  ["Quote 0,6 und verlorener Anruf: sofort rot", [gut({ fehlerquoteProzent: 0.6, verloreneAnrufe: 1 }), gut()], 1, false, ["fehlerquote", "verlorene_anrufe"]],
  ["Quote 0,6 und Wartezeit 121 s: sofort rot", [gut({ fehlerquoteProzent: 0.6, wartezeitSekunden: 121 }), gut()], 1, false, ["fehlerquote", "wartezeit"]],
  [
    "Quote 0,6 und Route ueber Budget: sofort rot",
    [gut({ fehlerquoteProzent: 0.6, routen: [{ name: "r", istMs: 3, budgetMs: 2 }] }), gut()],
    1,
    false,
    ["fehlerquote", "route_ueber_budget:r"],
  ],
  ["verlorener Anruf ohne Quote: sofort rot", [gut({ verloreneAnrufe: 2 }), gut()], 1, false, ["verlorene_anrufe"]],
  ["Quote fehlt: keine Wiederholung", [gut({ fehlerquoteProzent: undefined }), gut()], 1, false, ["messwert_fehlt:fehlerquote"]],
];

for (const [name, ergebnisse, laeufe, gruen, gruende] of FAELLE) {
  test(`Lastlauf-Wiederholung: ${name}`, async () => {
    const ergebnis = await lauf(ergebnisse);
    assert.equal(ergebnis.laeufe, laeufe);
    assert.deepEqual(ergebnis.urteil, { gruen, gruende });
    assert.equal(ergebnis.stand.gestartet, 1);
    assert.equal(ergebnis.stand.geschlossen, 1);
  });
}

test("Lastlauf-Wiederholung: der Wert des ersten Laufs steht im Ergebnis und im Log, die Fehlerart mit", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (zeile) => void zeilen.push(String(zeile)));
  const erster = gut({ fehlerquoteProzent: 0.683, anfragen: 440, httpFehlgeschlagen: 2, ablaufFehler: 1 });
  const ergebnis = await lauf([erster, gut({ fehlerquoteProzent: 0.3 })]);
  assert.deepEqual(ergebnis.ersterLauf, { ergebnis: erster, urteil: { gruen: false, gruende: ["fehlerquote"] } });
  assert.equal(ergebnis.ergebnis.fehlerquoteProzent, 0.3);
  const log = zeilen.join("\n");
  assert.match(log, /erster Lauf/);
  assert.match(log, /0\.683/);
  assert.match(log, /http_req_failed 2/);
  assert.match(log, /ablauf_fehler 1/);
  assert.match(log, /440 Anfragen/);
});

test("Lastlauf-Wiederholung: ohne Wiederholung gibt es keinen ersten Lauf und kein Log", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (zeile) => void zeilen.push(String(zeile)));
  const ergebnis = await lauf([gut()]);
  assert.equal(ergebnis.ersterLauf, undefined);
  assert.deepEqual(zeilen, []);
});

test("Lastlauf-Wiederholung: Log ohne Aufteilung nennt nur die Quote", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (zeile) => void zeilen.push(String(zeile)));
  await lauf([gut({ fehlerquoteProzent: 0.6 }), gut()]);
  assert.match(zeilen.join("\n"), /0\.6 %/);
  assert.doesNotMatch(zeilen.join("\n"), /http_req_failed/);
});

const NUR_QUOTE = [
  [{ gruen: false, gruende: ["fehlerquote"] }, true],
  [{ gruen: false, gruende: ["fehlerquote", "wartezeit"] }, false],
  [{ gruen: false, gruende: ["wartezeit"] }, false],
  [{ gruen: false, gruende: ["messwert_fehlt:fehlerquote"] }, false],
  [{ gruen: true, gruende: [] }, false],
];

for (const [urteil, erwartet] of NUR_QUOTE) {
  test(`Lastlauf-Wiederholung: nurFehlerquoteUeberGrenze ${JSON.stringify(urteil.gruende)}`, () => {
    assert.equal(nurFehlerquoteUeberGrenze(urteil), erwartet);
  });
}

test("Lastlauf-Wiederholung: baueErgebnis nennt Anfragen und die Aufteilung nach http_req_failed und ablauf_fehler", () => {
  const daten = {
    metrics: {
      http_reqs: { values: { count: 400 } },
      http_req_failed: { values: { passes: 3 } },
      ablauf_fehler: { values: { count: 1 } },
    },
  };
  const ergebnis = baueErgebnis(daten);
  assert.equal(ergebnis.anfragen, 400);
  assert.equal(ergebnis.httpFehlgeschlagen, 3);
  assert.equal(ergebnis.ablaufFehler, 1);
  assert.equal(ergebnis.fehlerquoteProzent, 1);
});
