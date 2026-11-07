import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { zweiProzesse } from "../gemeinsam/zwei-prozesse.js";

const ZEITGRENZE_MS = 180_000;
const GRENZE = 10;
const FENSTER_MS = 60_000;
const HTTP_FOUND = 302;
const LOGIN_PFAD = "/auth/login";
const KOPF_ABSENDER = "x-forwarded-for";
const ABLAUFENDE_ADRESSE = "198.51.100.1";
const ANDERE_ADRESSE = "198.51.100.2";
const NEBENSTEHENDE_ADRESSE = "198.51.100.3";
const KONTROLL_ADRESSEN = ["203.0.113.1", "203.0.113.2"];

const UMGEBUNG = {
  SESSION_SECRET: "login-bremse-sitzungsgeheimnis-mind-32-zeichen",
  OIDC_CLIENT_ID: "login-bremse-client",
  OIDC_CLIENT_SECRET: "login-bremse-client-geheimnis",
  LOGIN_RATE_LIMIT_PER_MIN: String(GRENZE),
};

async function loginStatus(prozess, absender) {
  const antwort = await abrufMitFrist(`${prozess.localUrl}${LOGIN_PFAD}`, {
    redirect: "manual",
    headers: { [KOPF_ABSENDER]: absender },
  });
  await antwort.text();
  return antwort.status;
}

async function schluessel(adresse) {
  return mitVerbindung(adresse, async (verbindung) => {
    const { rows } = await verbindung.query("SELECT schluessel FROM login_bremse");
    return new Set(rows.map(({ schluessel: wert }) => wert));
  });
}

function fensterZuruecksetzen(adresse, wert) {
  return mitVerbindung(adresse, (verbindung) =>
    verbindung.query("UPDATE login_bremse SET beginn_ms = beginn_ms - $2 WHERE schluessel = $1", [
      wert,
      FENSTER_MS,
    ]),
  );
}

async function neuerSchluessel(adresse, prozess, absender) {
  const vorher = await schluessel(adresse);
  assert.equal(await loginStatus(prozess, absender), HTTP_FOUND, `Anfrage von ${absender}`);
  const neu = [...(await schluessel(adresse))].filter((wert) => !vorher.has(wert));
  assert.equal(neu.length, 1, `Anfrage von ${absender} legt genau eine Zeile an`);
  return neu[0];
}

async function positivKontrolle(a, b) {
  assert.deepEqual(
    [await loginStatus(a, KONTROLL_ADRESSEN[0]), await loginStatus(b, KONTROLL_ADRESSEN[1])],
    [HTTP_FOUND, HTTP_FOUND],
    "Positiv-Kontrolle: /auth/login muss für eine frische Adresse umleiten",
  );
}

test(
  "Login-Bremse: eine abgelaufene Zeile verschwindet nach der Anfrage einer anderen Adresse, nicht abgelaufene bleiben",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (process.env.CI && !process.env[POSTGRES_VARIABLE]) {
      assert.fail(`${POSTGRES_VARIABLE} fehlt in der CI, der Test darf nicht überspringen`);
    }
    const rolle = await echteDatenbankMitRolle(t);
    if (!rolle) return;
    const { a, b } = await zweiProzesse(t, { ...UMGEBUNG, DATABASE_URL: rolle.adresse });
    await positivKontrolle(a, b);

    const abgelaufen = await neuerSchluessel(rolle.adresse, a, ABLAUFENDE_ADRESSE);
    const nebenstehend = await neuerSchluessel(rolle.adresse, a, NEBENSTEHENDE_ADRESSE);
    await fensterZuruecksetzen(rolle.adresse, abgelaufen);
    assert.ok((await schluessel(rolle.adresse)).has(abgelaufen), "Vorbedingung: Zeile liegt vor");

    const frisch = await neuerSchluessel(rolle.adresse, b, ANDERE_ADRESSE);

    const nachher = await schluessel(rolle.adresse);
    assert.ok(!nachher.has(abgelaufen), "die abgelaufene Zeile ist entfernt");
    assert.ok(nachher.has(nebenstehend), "die nicht abgelaufene Zeile bleibt stehen");
    assert.ok(nachher.has(frisch), "die Zeile der anfragenden Adresse steht");
    assert.equal(nachher.size, 2 + KONTROLL_ADRESSEN.length, "die Kontrollzeilen bleiben stehen");
  },
);
