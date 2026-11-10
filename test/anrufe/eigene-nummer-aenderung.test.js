import { test } from "node:test";
import assert from "node:assert/strict";

const HTTP_OK = 200;
const HTTP_BAD_GATEWAY = 502;
const HTTP_TOO_MANY = 429;
const ZIEL_DECKEL = 3;
const NUMMER_ALT = "+491713920012";
const NUMMER_ANDERE = "+491713920077";
const NUMMER_GELOESCHT = "+491713920055";

Object.assign(process.env, {
  OWNER_SELF_CALL_ENABLED: "true",
  OWNER_SELF_CALL_TENANT_IDS: "t_kv2-betreiber",
  ALLOWED_COUNTRY_CODES: "+49",
  PER_TARGET_CALL_CAP: String(ZIEL_DECKEL),
  MAX_CALLS_PER_HOUR: "100",
  MULTI_TENANT: "true",
  SELF_SERVICE_ENABLED: "true",
});

const { starteHermesMitPglite, LOGIN_SUB } = await import("../abrechnung/server-mit-testdatenbank.js");
const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "postfach@en.invalid",
  anrufstartAbgelehnt: true,
});

let zaehler = 0;
const rufeAn = (hermes, to) =>
  hermes.anfrage("/api/calls", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-identity": LOGIN_SUB },
    body: JSON.stringify({ to, objective: `Auftrag ${++zaehler}` }),
  });

const setzeNummer = async (hermes, sessionCookie, privateNumber) => {
  const res = await hermes.anfrage("/api/self-service/private-number", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ privateNumber }),
  });
  assert.equal(res.status, HTTP_OK);
};

async function vierAnrufeGehenDurch(hermes, to) {
  for (let i = 0; i <= ZIEL_DECKEL; i++) assert.equal((await rufeAn(hermes, to)).status, HTTP_BAD_GATEWAY);
}

async function naechsterAnrufAbgelehnt(hermes, to) {
  const res = await rufeAn(hermes, to);
  assert.equal(res.status, HTTP_TOO_MANY);
  assert.equal((await res.json()).reason, "ziel_limit");
}

test("EN-AEND-1: nach Aenderung der eigenen Nummer endet der naechste Anruf an die alte Nummer mit ziel_limit", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie } = await hermes.anmelden();
  await hermes.betreiberDarfAnrufen();
  await setzeNummer(hermes, sessionCookie, NUMMER_ALT);
  await vierAnrufeGehenDurch(hermes, NUMMER_ALT);
  await setzeNummer(hermes, sessionCookie, NUMMER_ANDERE);
  await naechsterAnrufAbgelehnt(hermes, NUMMER_ALT);
});

test("EN-AEND-2: nach Loeschen der eigenen Nummer endet der naechste Anruf an die alte Nummer mit ziel_limit", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie } = await hermes.anmelden();
  await hermes.betreiberDarfAnrufen();
  await setzeNummer(hermes, sessionCookie, NUMMER_GELOESCHT);
  await vierAnrufeGehenDurch(hermes, NUMMER_GELOESCHT);
  await setzeNummer(hermes, sessionCookie, null);
  await naechsterAnrufAbgelehnt(hermes, NUMMER_GELOESCHT);
});
