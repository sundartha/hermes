import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite, LOGIN_SUB } from "./server-mit-testdatenbank.js";

const HTTP_OK = 200;
const HTTP_FOUND = 302;
const ALARM_POSTFACH = "postfach@kv2.invalid";
const DECKUNG_BEFUND = /^grund=coverage_below_threshold deckung=0% /;

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: ALARM_POSTFACH });
let sitzung = "";

test("KV2-1 (e) Verhalten: Web-Anmeldung über den Rückruf gibt eine Sitzung und schreibt 'login' ins Prüfprotokoll", async () => {
  const hermes = laufendesHermes();
  const { rueckruf, sessionCookie } = await hermes.anmelden();
  assert.equal(rueckruf.status, HTTP_FOUND, "der Rückruf leitet nach erfolgreicher Anmeldung weiter");
  assert.ok(sessionCookie, "der Rückruf setzt das Sitzungs-Cookie");
  sitzung = sessionCookie;

  const logins = await hermes.warteAufProtokoll("login", (zeile) => zeile.actor_sub === LOGIN_SUB);
  assert.equal(logins.length, 1, "genau ein 'login'-Eintrag für den angemeldeten Betreiber");
});

test("KV2-1 (e) Verhalten: der Kostenalarm aus dem Sweep landet als Mail im Test-Postfach und als Eintrag im Prüfprotokoll", async () => {
  const hermes = laufendesHermes();
  assert.ok(sitzung, "setzt die Anmeldung aus dem Fall davor voraus");
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)", [LOGIN_SUB]);

  const sweep = await hermes.anfrage("/api/billing/cost-truing/sweep", { method: "POST", headers: { cookie: sitzung } });
  assert.equal(sweep.status, HTTP_OK, "der angemeldete Betreiber darf den Sweep auslösen");

  const befunde = await hermes.warteAufProtokoll("cost_truing_befund", (zeile) => DECKUNG_BEFUND.test(zeile.detail ?? ""));
  assert.equal(befunde.length, 1, "der Deckungsbefund steht genau einmal im Prüfprotokoll (audit_log)");

  const alarmMails = hermes.testPostfach.filter((mail) => DECKUNG_BEFUND.test(mail.textContent ?? ""));
  assert.equal(alarmMails.length, 1, "genau eine Alarm-Mail zum Deckungsbefund");
  const [mail] = alarmMails;
  assert.deepEqual(mail.to, [{ email: ALARM_POSTFACH }], "die Mail geht an PLATFORM_ALERT_MAIL_TO");
  assert.equal(mail.textContent, befunde[0].detail, "Mail und Prüfprotokoll tragen denselben Befund");
});
