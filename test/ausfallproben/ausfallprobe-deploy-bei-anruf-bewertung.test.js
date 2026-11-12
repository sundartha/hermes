import { test } from "node:test";
import assert from "node:assert/strict";
import { bewerteAbschaltung } from "../../scripts/ausfallproben/proben/deploy-bei-anruf.mjs";

const SCHWELLE = { beendetMs: 8000 };
const FLUSH = "[shutdown] Signal SIGTERM\n[shutdown] Finaler Store-Flush abgeschlossen\n";

const FAELLE = [
  ["Exit 0, Flush-Zeile, 7000 ms: gut", { exitCode: 0, text: FLUSH, dauerMs: 7000 }, null],
  ["Exit 0 genau an der Frist: gut", { exitCode: 0, text: FLUSH, dauerMs: 8000 }, null],
  [
    "eine Millisekunde nach der Frist: rot",
    { exitCode: 0, text: FLUSH, dauerMs: 8001 },
    "Hermes beendete sich nicht binnen 8000 ms nach SIGTERM",
  ],
  [
    "nicht beendet: rot",
    { exitCode: null, text: FLUSH, dauerMs: null },
    "Hermes beendete sich nicht binnen 8000 ms nach SIGTERM",
  ],
  [
    "Exit 1 (Gesamtfrist abgelaufen): rot",
    { exitCode: 1, text: FLUSH, dauerMs: 8000 },
    "Hermes beendete sich nicht mit Exit 0",
  ],
  [
    "Exit 0 ohne Flush-Zeile: rot",
    { exitCode: 0, text: "[shutdown] Signal SIGTERM\n", dauerMs: 100 },
    "Die Zeile mit dem abgeschlossenen Store-Flush fehlt",
  ],
  [
    "Flush fehlgeschlagen: rot",
    {
      exitCode: 0,
      text: "[shutdown] Finaler Store-Flush FEHLGESCHLAGEN - Datenverlust moeglich: x\n",
      dauerMs: 100,
    },
    "Die Zeile mit dem abgeschlossenen Store-Flush fehlt",
  ],
];

for (const [name, eingabe, grund] of FAELLE) {
  test(`deploy-bei-anruf: ${name}`, () => {
    assert.equal(bewerteAbschaltung({ ...eingabe, schwelle: SCHWELLE }), grund);
  });
}
