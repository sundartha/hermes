import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite, LOGIN_SUB } from "./server-mit-testdatenbank.js";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "", eingang: true });

test("KV2-1 (e) Verhalten: mit Alarm-Eingang, ohne SMS und Mail, warnt der Serverstart nicht mit 'kosten_alarm_ohne_ziel'", async () => {
  const hermes = laufendesHermes();
  await hermes.anmelden();
  const logins = await hermes.warteAufProtokoll("login", (zeile) => zeile.actor_sub === LOGIN_SUB);
  assert.equal(logins.length, 1, "der Start ist durchgelaufen: die Anmeldung steht im Prüfprotokoll");
  const warnungen = await hermes.db.query("SELECT id FROM audit_log WHERE action = $1", ["kosten_alarm_ohne_ziel"]);
  assert.equal(warnungen.rows.length, 0, "mit Eingang sieht jemand die Kosten-Befunde, keine Warnung");
  assert.equal(hermes.testPostfach.length, 0, "ohne Alarmziel geht keine Mail hinaus");
});
