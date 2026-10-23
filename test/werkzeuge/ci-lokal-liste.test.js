import assert from "node:assert/strict";
import { test } from "node:test";

import { eintraegeDerZuordnung, quelltext, urteilt } from "./zweck-quellen.js";

const LISTE = "tools/ci-lokal.json";
const ERFUNDEN = ".github/workflows/ci.yml › pruefungen › Erfundene Prüfung";
const NICHTS_FEHLT = { ohneEintrag: [], doppelt: [], ohneSchritt: [], ohneGrund: [] };

function echteListe() {
  return JSON.parse(quelltext(LISTE));
}

function abgleich(zuordnung, { schritte, nurCi }) {
  const urteilend = Object.keys(zuordnung).filter((name) => urteilt(zuordnung[name]));
  const genannt = [...schritte.flatMap((schritt) => schritt.ci ?? []), ...Object.keys(nurCi)];
  return {
    ohneEintrag: urteilend.filter((name) => !genannt.includes(name)),
    doppelt: genannt.filter((name, stelle) => genannt.indexOf(name) !== stelle),
    ohneSchritt: genannt.filter((name) => !urteilend.includes(name)),
    ohneGrund: Object.keys(nurCi).filter((name) => nurCi[name].trim() === ""),
  };
}

test("jeder urteilende Schritt der Pflicht-Checks läuft in ci-lokal oder steht mit Grund unter nur CI, und die Liste nennt nichts anderes", () => {
  assert.deepEqual(abgleich(eintraegeDerZuordnung(), echteListe()), NICHTS_FEHLT);
});

function mitErfundenemSchritt(eintrag) {
  return abgleich({ ...eintraegeDerZuordnung(), [ERFUNDEN]: eintrag }, echteListe());
}

test("Abgleich der ci-lokal-Liste: neuer Schritt mit Zweck fehlt in der Liste", () => {
  assert.deepEqual(mitErfundenemSchritt({ zweck: ["uebrige/erfunden"] }), { ...NICHTS_FEHLT, ohneEintrag: [ERFUNDEN] });
});

test("Abgleich der ci-lokal-Liste: neuer Schritt mit Gruppen fehlt in der Liste", () => {
  assert.deepEqual(mitErfundenemSchritt({ gruppen: { "uebrige/erfunden": "Teil" } }), { ...NICHTS_FEHLT, ohneEintrag: [ERFUNDEN] });
});

test("Abgleich der ci-lokal-Liste: neuer Aufbauschritt braucht keinen Eintrag", () => {
  assert.deepEqual(mitErfundenemSchritt({ aufbau: "Installiert nur." }), NICHTS_FEHLT);
});

test("Abgleich der ci-lokal-Liste: neuer Meldeschritt braucht keinen Eintrag", () => {
  assert.deepEqual(mitErfundenemSchritt({ meldet: "Zeigt nur an." }), NICHTS_FEHLT);
});

test("Abgleich der ci-lokal-Liste meldet einen Schlüssel ohne Schritt, einen doppelten und einen leeren Grund", () => {
  const liste = echteListe();
  const [erster] = liste.schritte;
  const verfaelscht = {
    schritte: [...liste.schritte, { ...erster, ci: [...erster.ci, ERFUNDEN] }],
    nurCi: { ...liste.nurCi, [ERFUNDEN]: " " },
  };
  assert.deepEqual(abgleich(eintraegeDerZuordnung(), verfaelscht), {
    ohneEintrag: [],
    doppelt: [...erster.ci, ERFUNDEN],
    ohneSchritt: [ERFUNDEN, ERFUNDEN],
    ohneGrund: [ERFUNDEN],
  });
});
