import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUPPEN, LAUF_FRIST_MS, ORDNER, aufrufe, exit, planOrdner, planeIn } from "./planung-probe.js";
import { A2_BEFUND, AUFTRAG, EXIT_GRUEN, MIT_NUMMER, UEBERGREIFENDER_PRUEFER, antwortMit, jePruefer, planeAntworten, planungsBericht } from "./planung-plane-probe.js";

const EXIT_DECKEL = 5;
const MIO = 1_000_000;
const DECKEL_OHNE_WIRKUNG = 1000 * MIO;
const PLANER = 100_000;
const ERKUNDER = MIO;
const WEGPRUEFER = 340_000;
const TOKEN = { planer: PLANER, erkunder: ERKUNDER, "pruefer-planung": WEGPRUEFER, entwurf: PLANER };
const BEFUND_UND_KORREKTUR = { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)] };

const ERSTE_WELLE = GRUPPEN.length;
const PRUEFLISTE_LAEUFE = GRUPPEN.length + UEBERGREIFENDER_PRUEFER;
const PLANER_ANTWORTEN_BIS_NACHPRUEFUNG = 3;
const VOR_NACHPRUEFUNG = PLANER_ANTWORTEN_BIS_NACHPRUEFUNG * PLANER + ERSTE_WELLE * (ERKUNDER + WEGPRUEFER) + PRUEFLISTE_LAEUFE * WEGPRUEFER;
const DECKEL_VOR_NACHPRUEFUNG = VOR_NACHPRUEFUNG + WEGPRUEFER / 2;

function planeMitDeckel(context, wurzel, argumente) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: BEFUND_UND_KORREKTUR, argumente: ["plane", ORDNER, ...argumente], token: TOKEN });
}

test("plane --deckel: passt die Antwort des Planers nach der Prüfliste noch, die Nachprüfung aber nicht mehr unter den Deckel, startet plane keinen Nachprüfer, legt den Fingerabdruck ab und lässt sich fortsetzen", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitDeckel(context, planOrdner(context), ["--deckel", String(DECKEL_VOR_NACHPRUEFUNG)]);

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PRUEFLISTE_LAEUFE);
  assert.equal(aufrufe(lauf, "planer").length, PLANER_ANTWORTEN_BIS_NACHPRUEFUNG);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Nachprüfung").length, 0);
  assert.match(planungsBericht(lauf).deckelSchritt, /^Nachprüfung$/);
  assert.deepEqual(planungsBericht(lauf).deckel, { deckel: DECKEL_VOR_NACHPRUEFUNG, gemessen: VOR_NACHPRUEFUNG, vorschau: WEGPRUEFER });
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", "fingerabdruck.json")), true);

  const fortgesetzt = planeMitDeckel(context, lauf.wurzel, ["--fortsetzen", "--deckel", String(DECKEL_OHNE_WIRKUNG)]);
  exit(fortgesetzt, EXIT_GRUEN);
  assert.equal(aufrufe(fortgesetzt, "erkunder").length, 0);
  assert.equal(aufrufe(fortgesetzt, "pruefer-planung", "## Nachprüfung").length, 1);
});
