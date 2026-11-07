import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { beenden, zweiProzesse } from "../gemeinsam/zwei-prozesse.js";

const ZEITGRENZE_MS = 180_000;
const GRENZE = 10;
const HAELFTE = 5;
const FENSTER_MS = 60_000;
const HTTP_FOUND = 302;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;
const RETRY_AFTER_MAX_S = 60;
const LOGIN_PFAD = "/auth/login";
const CALLBACK_PFAD = "/auth/callback";
const KOPF_ABSENDER = "x-forwarded-for";
const GESPERRT_KOERPER = { error: "Zu viele Anfragen. Bitte spaeter erneut versuchen." };
const ABSENDER = "198.51.100.1";
const ANDERER_ABSENDER = "198.51.100.2";
const GEHEIMNIS = "login-bremse-sitzungsgeheimnis-mind-32-zeichen";
const ANDERES_GEHEIMNIS = "login-bremse-anderes-geheimnis-mind-32-zeichen";
const ABGELAUFENE_ZEILEN = 5;
const ABGELAUFEN_VOR_MS = 2 * FENSTER_MS;
const KEINE_FRISCHE_ADRESSE = "203.0.113.";

const UMGEBUNG = {
  SESSION_SECRET: GEHEIMNIS,
  OIDC_CLIENT_ID: "login-bremse-client",
  OIDC_CLIENT_SECRET: "login-bremse-client-geheimnis",
  LOGIN_RATE_LIMIT_PER_MIN: String(GRENZE),
};

let frischeAdresse = 0;

function naechsteFrischeAdresse() {
  frischeAdresse += 1;
  return `${KEINE_FRISCHE_ADRESSE}${frischeAdresse}`;
}

async function abruf(prozess, absender, pfad = LOGIN_PFAD) {
  const antwort = await abrufMitFrist(`${prozess.localUrl}${pfad}`, {
    redirect: "manual",
    headers: { [KOPF_ABSENDER]: absender },
  });
  const text = await antwort.text();
  return { status: antwort.status, headers: antwort.headers, text };
}

async function status(prozess, absender, pfad) {
  return (await abruf(prozess, absender, pfad)).status;
}

function statusAlle(orte, absender, pfad) {
  return Promise.all(orte.map((prozess) => status(prozess, absender, pfad)));
}

function mal(prozess, anzahl) {
  return Array.from({ length: anzahl }, () => prozess);
}

async function nacheinander(orte, absender, pfad) {
  const stati = [];
  for (const prozess of orte) stati.push(await status(prozess, absender, pfad));
  return stati;
}

async function mitSitzung(t, arbeit, env = {}) {
  if (process.env.CI && !process.env[POSTGRES_VARIABLE]) {
    assert.fail(`${POSTGRES_VARIABLE} fehlt in der CI, der Test darf nicht überspringen`);
  }
  const rolle = await echteDatenbankMitRolle(t);
  if (!rolle) return;
  const umgebung = { ...UMGEBUNG, ...env, DATABASE_URL: rolle.adresse };
  const prozesse = await zweiProzesse(t, umgebung);
  const sitzung = { t, adresse: rolle.adresse, umgebung, a: prozesse.a, b: prozesse.b };
  await positivKontrolle(sitzung);
  await arbeit(sitzung);
}

async function positivKontrolle({ a, b }) {
  assert.deepEqual(
    [await status(a, naechsteFrischeAdresse()), await status(b, naechsteFrischeAdresse())],
    [HTTP_FOUND, HTTP_FOUND],
    "Positiv-Kontrolle: /auth/login muss für eine frische Adresse umleiten",
  );
}

async function neustarten(sitzung, env = {}) {
  await beenden(sitzung.a);
  await beenden(sitzung.b);
  sitzung.umgebung = { ...sitzung.umgebung, ...env };
  const { a, b } = await zweiProzesse(sitzung.t, sitzung.umgebung);
  Object.assign(sitzung, { a, b });
}

function bremseZeilen(adresse) {
  return mitVerbindung(adresse, async (verbindung) => {
    const { rows } = await verbindung.query("SELECT t::text AS zeile FROM login_bremse t");
    return rows.map(({ zeile }) => zeile);
  });
}

function schluessel(adresse) {
  return mitVerbindung(adresse, async (verbindung) => {
    const { rows } = await verbindung.query("SELECT schluessel FROM login_bremse");
    return rows.map(({ schluessel: wert }) => wert);
  });
}

function fensterZuruecksetzen(adresse) {
  return mitVerbindung(adresse, (verbindung) =>
    verbindung.query("UPDATE login_bremse SET beginn_ms = beginn_ms - $1", [FENSTER_MS]),
  );
}

function abgelaufeneZeilenAnlegen(adresse) {
  return mitVerbindung(adresse, (verbindung) =>
    verbindung.query(
      `INSERT INTO login_bremse (schluessel, anzahl, beginn_ms)
       SELECT 'abgelaufen-' || n, $1, $2 FROM generate_series(1, $3) AS n`,
      [GRENZE - 1, Date.now() - ABGELAUFEN_VOR_MS, ABGELAUFENE_ZEILEN],
    ),
  );
}

function tabelleEntfernen(adresse) {
  return mitVerbindung(adresse, (verbindung) => verbindung.query("DROP TABLE login_bremse"));
}

function darstellungen(wert) {
  return [wert.toString("hex"), wert.toString("base64"), wert.toString("base64url")];
}

function verbotene(absender, geheimnis) {
  const roh = createHash("sha256").update(absender).digest();
  const mac = createHmac("sha256", geheimnis).update(absender).digest();
  return [absender, ...darstellungen(roh), ...darstellungen(mac)];
}

async function bisZurGrenze(sitzung, absender) {
  const stati = await nacheinander(
    [...mal(sitzung.a, HAELFTE), ...mal(sitzung.b, HAELFTE)],
    absender,
  );
  assert.deepEqual(stati, Array(GRENZE).fill(HTTP_FOUND), "die ersten 10 Anfragen laufen durch");
}

test(
  "Login-Bremse: 5 Anfragen an A und 5 an B laufen durch, die 11. wird an beiden Prozessen mit 429 abgelehnt",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await bisZurGrenze(sitzung, ABSENDER);
      for (const prozess of [sitzung.a, sitzung.b]) {
        const antwort = await abruf(prozess, ABSENDER);
        assert.equal(antwort.status, HTTP_TOO_MANY, "die 11. Anfrage wird gesperrt");
        assert.deepEqual(JSON.parse(antwort.text), GESPERRT_KOERPER);
        const retryAfter = antwort.headers.get("retry-after");
        assert.match(retryAfter, /^\d+$/, "Retry-After ist eine ganze Zahl");
        assert.ok(
          Number(retryAfter) >= 1 && Number(retryAfter) <= RETRY_AFTER_MAX_S,
          `Retry-After liegt zwischen 1 und 60, war ${retryAfter}`,
        );
      }
    }),
);

test(
  "Login-Bremse: ist eine Adresse über 5+5 gesperrt, bleibt eine andere Adresse an A und B frei",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await bisZurGrenze(sitzung, ABSENDER);
      assert.equal(await status(sitzung.a, ABSENDER), HTTP_TOO_MANY);
      assert.deepEqual(await statusAlle([sitzung.a, sitzung.b], ANDERER_ABSENDER), [
        HTTP_FOUND,
        HTTP_FOUND,
      ]);
    }),
);

test(
  "Login-Bremse: ein Neustart beider Prozesse im selben Fenster hebt die Sperre nicht auf",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await bisZurGrenze(sitzung, ABSENDER);
      await neustarten(sitzung);
      assert.equal(await status(sitzung.a, ABSENDER), HTTP_TOO_MANY, "11. Anfrage an neues A");
      assert.equal(await status(sitzung.b, ABSENDER), HTTP_TOO_MANY, "12. Anfrage an neues B");
    }),
);

test(
  "Login-Bremse: nach Ablauf des Fensters beginnt der Zähler bei 1 und lässt genau 10 Anfragen durch",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await bisZurGrenze(sitzung, ABSENDER);
      assert.equal(await status(sitzung.a, ABSENDER), HTTP_TOO_MANY);
      await fensterZuruecksetzen(sitzung.adresse);
      const neuesFenster = await nacheinander(
        [...mal(sitzung.a, HAELFTE), ...mal(sitzung.b, HAELFTE)],
        ABSENDER,
      );
      assert.deepEqual(neuesFenster, Array(GRENZE).fill(HTTP_FOUND), "10 Anfragen im neuen Fenster");
      assert.equal(await status(sitzung.a, ABSENDER), HTTP_TOO_MANY, "die 11. im neuen Fenster");
    }),
);

test(
  "Login-Bremse: 20 gleichzeitige Anfragen bei abgelaufenen Fremdzeilen ergeben genau 10 mal 302 und 10 mal 429",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await abgelaufeneZeilenAnlegen(sitzung.adresse);
      const stati = await statusAlle(
        [...mal(sitzung.a, GRENZE), ...mal(sitzung.b, GRENZE)],
        ABSENDER,
      );
      assert.deepEqual(
        stati.filter((wert) => wert >= HTTP_SERVER_ERROR),
        [],
        "kein Status ab 500",
      );
      assert.equal(stati.filter((wert) => wert === HTTP_FOUND).length, GRENZE);
      assert.equal(stati.filter((wert) => wert === HTTP_TOO_MANY).length, GRENZE);
    }),
);

test(
  "Login-Bremse: die Tabelle enthält weder die Adresse noch deren SHA-256 oder HMAC mit dem Sitzungsgeheimnis, und ein anderes Geheimnis ergibt einen anderen Schlüssel",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      assert.equal(await status(sitzung.a, ABSENDER), HTTP_FOUND);
      const zeilen = (await bremseZeilen(sitzung.adresse)).join("\n");
      assert.ok(zeilen.length > 0, "die Anfrage hinterlässt eine Zeile");
      const treffer = verbotene(ABSENDER, GEHEIMNIS).filter((wert) => zeilen.includes(wert));
      assert.deepEqual(treffer, [], "geschützte Darstellung der Adresse in der Tabelle");
      const vorher = await schluessel(sitzung.adresse);
      await neustarten(sitzung, { SESSION_SECRET: ANDERES_GEHEIMNIS });
      assert.equal(await status(sitzung.a, ABSENDER), HTTP_FOUND);
      const nachher = await schluessel(sitzung.adresse);
      const neu = nachher.filter((wert) => !vorher.includes(wert));
      assert.equal(neu.length, 1, "mit anderem Geheimnis entsteht ein weiterer Schlüssel");
      const andererMac = verbotene(ABSENDER, ANDERES_GEHEIMNIS);
      assert.deepEqual(
        andererMac.filter((wert) => (neu[0] ?? "").includes(wert)),
        [],
        "auch der neue Schlüssel enthält keine geschützte Darstellung",
      );
    }),
);

test(
  "Login-Bremse: scheitert das Zählen, erreicht die Anfrage die Login-Route nicht",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await tabelleEntfernen(sitzung.adresse);
      const antwort = await abruf(sitzung.a, naechsteFrischeAdresse());
      assert.notEqual(antwort.status, HTTP_FOUND, "ohne Zähler kein Redirect zum Anbieter");
      const cookies = antwort.headers.getSetCookie().join("\n");
      assert.ok(!cookies.includes("pkce_verifier"), "kein Anmelde-Cookie ohne Zähler");
    }),
);

test(
  "Login-Bremse: Treffer zählen gemeinsam über alle Pfade unter /auth",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async (sitzung) => {
      await bisZurGrenze(sitzung, ABSENDER);
      assert.equal(await status(sitzung.b, ABSENDER, CALLBACK_PFAD), HTTP_TOO_MANY);
      assert.equal(await status(sitzung.a, ABSENDER, CALLBACK_PFAD), HTTP_TOO_MANY);
    }),
);
