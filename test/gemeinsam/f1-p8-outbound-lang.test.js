import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { setWorldDefaultLanguageEnabled } from "../../src/konfiguration/standardsprache.ts";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAbbrechendeAttrappe, vorspannSeedNummer } from "./vorspann-fahrzeug.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const TO = "+4915112345678";
const OWNER_FR_NUMBER = "+33123456789";
const abbrechend = await starteAbbrechendeAttrappe("sprache", [BOOTSTRAP_TENANT_ID]);
after(() => abbrechend.close());
setWorldDefaultLanguageEnabled(true);

function ownerSeed({ numberLanguage, settingsLanguage } = {}) {
  const number = {
    ...vorspannSeedNummer({ tenantId: BOOTSTRAP_TENANT_ID, nummer: OWNER_FR_NUMBER, id: "num_owner" }),
    country: "FR",
  };
  if (numberLanguage) number.language = numberLanguage;
  return seedState({
    settings: settingsLanguage ? { language: settingsLanguage } : {},
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
    numbers: [number],
  });
}

function placeCall(srv) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren" }),
  });
}

const ENV = { ALLOWED_NUMBERS: TO };
const ENV_VORSPANN = { ...abbrechend.env, ALLOWED_NUMBERS: TO };
const outboundCall = (srv) =>
  srv.readStore().calls.find((call) => call.direction === "outbound" && call.to === TO);

function placeCallWithLanguageWish(srv, language) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", language }),
  });
}

test("LANG-15 (Mechanismus, gruen) - ein Sprachwunsch wird NIE still ignoriert: ohne EL-Weg 400 statt Wirkungslosigkeit", async () => {
  const srv = await startServer({ env: ENV, seed: ownerSeed({ numberLanguage: "fr" }) });
  try {
    const vorAnzahl = srv.readStore().calls.length;
    const res = await placeCallWithLanguageWish(srv, "en");
    assert.equal(res.status, HTTP_BAD_REQUEST);
    assert.equal((await res.json()).code, "language_unavailable");
    assert.equal(srv.readStore().calls.length, vorAnzahl, "kein Anruf, kein Datensatz (E-3)");
  } finally {
    await srv.stop();
  }
});

test("LANG-26 (Mechanismus, gruen) - Inbound und Outbound leiten dieselbe Sprache aus derselben Nummer ab", async () => {
  const srv = await startServer({ env: ENV_VORSPANN, seed: ownerSeed({ numberLanguage: "fr" }) });
  try {
    const inboundRes = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAlang26",
        From: "+4915112345678",
        To: OWNER_FR_NUMBER,
      }),
    });
    assert.equal(inboundRes.status, HTTP_OK);
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR);
    const inboundCall = srv.readStore().calls.find((call) => call.direction === "inbound");
    assert.equal(inboundCall.language, "fr");
    assert.equal(outboundCall(srv).language, "fr");
    assert.equal(inboundCall.language, outboundCall(srv).language, "beide Richtungen stimmen ueberein");
  } finally {
    await srv.stop();
  }
});

test("Outbound-Sprache = language der eigenen aktiven Nummer (FR-Nummer -> call.language=fr)", async () => {
  const srv = await startServer({ env: ENV_VORSPANN, seed: ownerSeed({ numberLanguage: "fr" }) });
  try {
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR, "Gates passiert -> Offline-Originate (500)");
    assert.equal(outboundCall(srv).language, "de", "ohne language startet der Anruf auf de, die Nummer-Sprache (FR) zaehlt nicht");
  } finally {
    await srv.stop();
  }
});

test("Praezedenz #8: settings.language-Override schlaegt number.language (FR-Nummer + en -> call.language=en)", async () => {
  const srv = await startServer({
    env: ENV_VORSPANN,
    seed: ownerSeed({ numberLanguage: "fr", settingsLanguage: "en" }),
  });
  try {
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR);
    assert.equal(
      outboundCall(srv).language,
      "de",
      "ohne language startet der Anruf auf de, weder Owner-Einstellung (en) noch FR-Nummer zaehlen",
    );
  } finally {
    await srv.stop();
  }
});

test("Letzte Praezedenz-Stufe: Nummer ohne language -> call.language = Weltdefault", async () => {
  const srv = await startServer({ env: ENV_VORSPANN, seed: ownerSeed() });
  try {
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR);
    assert.equal(
      outboundCall(srv).language,
      "de",
      "ohne language startet der Anruf auf de, auch ohne Nummer-Sprache",
    );
  } finally {
    await srv.stop();
  }
});
