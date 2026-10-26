import assert from "node:assert/strict";
import { test } from "node:test";

import { LAUF_FRIST_MS, ROUTE, alsJson, angaben, bericht, exit, schnittliste } from "./planung-probe.js";
import { EXIT_GRUEN, plane, planungsBericht } from "./planung-plane-probe.js";

const NACHGEFRAGT = ["S1", "S2"];
const MARKE = "Bezahlter Bericht der Nachfrage";
const BEFUND = "Funktion gibtEsNicht fehlt in";
const ERFUNDEN = { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] };
const MIT_BEFUND = alsJson({ nummern: Object.fromEntries(NACHGEFRAGT.map((nummer) => [nummer, angaben(nummer, ERFUNDEN)])), hinweise: [MARKE] });
const FRAGEN = alsJson({ nachfragen: NACHGEFRAGT.map((nummer) => ({ nummern: [nummer], frage: `Wo endet ${nummer}?` })) });
const ZUSCHNITT = { "planer|## Zuschnitt": [FRAGEN, alsJson({ schnitt: schnittliste() })] };
const ERSTE_NACHFRAGE = { ...ZUSCHNITT, "erkunder|## Nachfrage|S1": [MIT_BEFUND] };

function eintragMit(wert, passt) {
  if (Array.isArray(wert)) return wert.find((eintrag) => eintragMit(eintrag, passt) !== undefined);
  if (wert === null || typeof wert !== "object") return undefined;
  return passt(wert) ? wert : Object.values(wert).find((eintrag) => eintragMit(eintrag, passt) !== undefined);
}

test("plane: die Befunde, die eine Rücksendung auslösen, stehen im Planbericht und im Log", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { ...ERSTE_NACHFRAGE, "erkunder|## Befunde": [bericht(NACHGEFRAGT)] });
  exit(lauf, EXIT_GRUEN);

  const eintrag = eintragMit(planungsBericht(lauf), (wert) => wert.rolle === "erkunder" && JSON.stringify(wert.nummern) === JSON.stringify(NACHGEFRAGT) && JSON.stringify(wert).includes(BEFUND));
  assert.ok(eintrag, JSON.stringify(planungsBericht(lauf), null, 2));
  assert.ok(`${lauf.stdout}${lauf.stderr}`.includes(BEFUND), `${lauf.stdout}\n${lauf.stderr}`);
});
