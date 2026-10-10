import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });

test("KV2-1 (e) Verhalten: ohne Alarmziel schreibt der Serverstart 'kosten_alarm_ohne_ziel' ins Prüfprotokoll", async () => {
  const hermes = laufendesHermes();
  const eintraege = await hermes.warteAufProtokoll("kosten_alarm_ohne_ziel");
  assert.equal(eintraege.length, 1, "genau ein Eintrag aus dem Serverstart");
  assert.equal(eintraege[0].detail, "kanaele=keine", "der Eintrag nennt nur die Kanal-Art, kein Ziel");
  assert.equal(hermes.testPostfach.length, 0, "ohne Alarmziel geht keine Mail hinaus");
});
