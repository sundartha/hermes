import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite, BETREIBER_MAIL, LOGIN_SUB } from "./server-mit-testdatenbank.js";

const HTTP_BAD_GATEWAY = 502;
const ZIEL = "+4917312345678";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@kv2.invalid", anrufstartAbgelehnt: true });

test("Verhalten: lehnt der Anbieter den Anrufstart ab, geht die Mail zum nicht zustande gekommenen Anruf an die Adresse des Kontos", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie } = await hermes.anmelden();
  assert.ok(sessionCookie, "die Anmeldung legt das Konto mit Mail-Adresse an");
  await hermes.betreiberDarfAnrufen();

  const antwort = await hermes.anfrage("/api/calls", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-identity": LOGIN_SUB },
    body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren" }),
  });
  assert.equal(antwort.status, HTTP_BAD_GATEWAY, "der Anrufstart scheitert erst beim Anbieter, nach allen Gates");

  const mails = hermes.testPostfach.filter((mail) => mail.textContent?.includes(ZIEL));
  assert.equal(mails.length, 1, "genau eine Mail zum nicht zustande gekommenen Anruf");
  assert.deepEqual(mails[0].to, [{ email: BETREIBER_MAIL }], "die Mail geht an die Adresse des angemeldeten Kontos");
});
