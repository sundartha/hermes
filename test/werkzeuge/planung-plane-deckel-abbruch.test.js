import assert from "node:assert/strict";
import { test } from "node:test";

import { AUFTRAG, EXIT_GRUEN, planeAntworten, planungsBericht } from "./planung-plane-probe.js";
import { LAUF_FRIST_MS, ORDNER, exit, planOrdner, planeIn } from "./planung-probe.js";

const TAUSEND = 1000;
const GLIEDERUNG_UND_ZUSCHNITT = 2;
const BEIDE_ENTWUERFE = 2;
const KLEIN = [5 * TAUSEND, 7 * TAUSEND];
const KLEIN_JE_AUFRUF = KLEIN.reduce((summe, groesse) => summe + groesse, 0);
const IN_JEDER_ROLLE_KLEIN = { planer: KLEIN, erkunder: KLEIN, "pruefer-planung": KLEIN, entwurf: KLEIN };

function kleinerGruenerLauf(context) {
  const lauf = planeIn(context, planOrdner(context), { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER], token: IN_JEDER_ROLLE_KLEIN });
  exit(lauf, EXIT_GRUEN);
  return lauf;
}

test("plane: planung.json nennt je Welle nur den Schritt und den gemessenen Verbrauch", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = kleinerGruenerLauf(context);

  const { wellen, token } = planungsBericht(lauf);
  assert.deepEqual(wellen.map(({ schritt }) => schritt), ["Antwort des Planers (gliederung)", "Erkundung", "Antwort des Planers (zuschnitt)", "Prüfliste", "Entwurfs-Welle"]);
  for (const welle of wellen) assert.ok(welle.gemessen > 0 && Object.keys(welle).toSorted().join() === "gemessen,schritt", JSON.stringify(welle));
  assert.equal(wellen.reduce((summe, { gemessen }) => summe + gemessen, 0), token);
});

test("plane: planung.json nennt je Rolle die Zahl der Läufe und ihre gemessenen Token", { timeout: LAUF_FRIST_MS }, (context) => {
  const { kostenJeLauf } = planungsBericht(kleinerGruenerLauf(context));

  assert.equal(kostenJeLauf.planer.laeufe, GLIEDERUNG_UND_ZUSCHNITT);
  assert.equal(kostenJeLauf.planer.token, GLIEDERUNG_UND_ZUSCHNITT * KLEIN_JE_AUFRUF);
  assert.equal(kostenJeLauf.entwurf.laeufe, BEIDE_ENTWUERFE);
});
