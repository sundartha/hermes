import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_LANGUAGE } from "../src/store/defaults.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const TO = "+4915112345678";
const OWNER_FR_NUMBER = "+33123456789";

function ownerSeed({ numberLanguage, settingsLanguage } = {}) {
  const number = {
    id: "num_owner",
    e164: OWNER_FR_NUMBER,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
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
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren" }),
  });
}

const ENV = { ALLOWED_NUMBERS: TO };
const outboundCall = (srv) =>
  srv.readStore().calls.find((call) => call.direction === "outbound" && call.to === TO);

function placeCallWithLanguageWish(srv, language) {
  return fetch(`${srv.localUrl}/api/calls`, {
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
  const srv = await startServer({ env: ENV, seed: ownerSeed({ numberLanguage: "fr" }) });
  try {
    const inboundRes = await fetch(`${srv.localUrl}/voice/incoming`, {
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
  const srv = await startServer({ env: ENV, seed: ownerSeed({ numberLanguage: "fr" }) });
  try {
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR, "Gates passiert -> Offline-Originate (500)");
    assert.equal(outboundCall(srv).language, "fr", "Outbound-Sprache aus number.language (FR)");
  } finally {
    await srv.stop();
  }
});

test("Praezedenz #8: settings.language-Override schlaegt number.language (FR-Nummer + en -> call.language=en)", async () => {
  const srv = await startServer({
    env: ENV,
    seed: ownerSeed({ numberLanguage: "fr", settingsLanguage: "en" }),
  });
  try {
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR);
    assert.equal(
      outboundCall(srv).language,
      "en",
      "Owner-Override (settings.language=en) schlaegt die FR-Nummer",
    );
  } finally {
    await srv.stop();
  }
});

test("Letzte Praezedenz-Stufe: Nummer ohne language -> call.language = Weltdefault", async () => {
  const srv = await startServer({ env: ENV, seed: ownerSeed() });
  try {
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR);
    assert.equal(
      outboundCall(srv).language,
      DEFAULT_LANGUAGE,
      "ohne Geo-Anker faellt die Praezedenz auf den Weltdefault durch",
    );
  } finally {
    await srv.stop();
  }
});
