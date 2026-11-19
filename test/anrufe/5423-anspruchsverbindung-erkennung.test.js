import assert from "node:assert/strict";
import { test } from "node:test";

import { warteAufAnspruchsverbindung } from "./anspruchsverbindung.js";

const BEGINN = "BEGIN";
const KONTEXT = "SELECT set_config('app.current_tenant', $1, true)";
const HOECHSTDAUER = "UPDATE call SET frist_hoechstdauer_at = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'active'";
const ZEITGRENZE = "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)";
const ANSPRUCH = "UPDATE call SET el_nachlauf_started_at = now() WHERE id = $1";
const ABSCHLUSS = "COMMIT";
const ZURUECK = "ROLLBACK";
const GEHALTEN = [0, 1];
const VORHER = [1, 1];

const TAKT = [BEGINN, KONTEXT, HOECHSTDAUER, ABSCHLUSS];
const NUR_ZURUECK = [BEGINN, ZURUECK];
const MIT_UPDATE = [BEGINN, ZEITGRENZE, ANSPRUCH, ABSCHLUSS];

const mitschnittAus = (verbindungen) => ({
  verbindungen: () => verbindungen,
  bisBedingung: async (bedingung) => assert.ok(bedingung(), JSON.stringify(verbindungen)),
});

const FAELLE = [
  { name: "Höchstdauer-Takt mit COMMIT zählt nicht als Anspruchsverbindung", verbindungen: [TAKT, NUR_ZURUECK], erwartet: [1] },
  { name: "Höchstdauer-Takt auf der zweiten gehaltenen Verbindung zählt nicht als Anspruchsverbindung", verbindungen: [NUR_ZURUECK, TAKT], erwartet: [0] },
  { name: "Höchstdauer-Takt, der erst den Kontext gesetzt hat, zählt nicht als Anspruchsverbindung", verbindungen: [[BEGINN, KONTEXT], NUR_ZURUECK], erwartet: [1] },
  { name: "Anspruch mit UPDATE und COMMIT nach Fristablauf bleibt Anspruchsverbindung", verbindungen: [TAKT, MIT_UPDATE], erwartet: [1] },
  { name: "Fremde Verbindung mit Zeitgrenze und ROLLBACK ohne Anspruch zählt nicht als Anspruchsverbindung", verbindungen: [[BEGINN, ZEITGRENZE, ZURUECK], NUR_ZURUECK], erwartet: [1] },
  { name: "Anspruch mit nur ROLLBACK ist Anspruchsverbindung", verbindungen: [NUR_ZURUECK, TAKT], erwartet: [0] },
];

for (const { name, verbindungen, erwartet } of FAELLE) {
  test(name, async () => {
    assert.deepEqual(await warteAufAnspruchsverbindung(mitschnittAus(verbindungen), VORHER, GEHALTEN), erwartet);
  });
}
