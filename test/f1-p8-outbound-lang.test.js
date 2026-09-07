// F1 Phase 8: Outbound-Gespraechssprache aus der EIGENEN aktiven Nummer (Geo-Anker)
// bzw. settings.language-Override. POST /api/calls leitet call.language ueber DIESELBE
// Praezedenz wie Inbound ab (resolveCallLanguage, Owner #8): settings.language ->
// number.language -> tenant.defaultLanguage -> "de". Der Call-Body-Param `language` wird
// seit P4a (F-2, LANG-15 aufgehoben) WIEDER beruecksichtigt - er ueberstimmt diese Kette
// fuer die GESPRAECHSSPRACHE, wenn der ElevenLabs-Weg an ist (s. LANG-15 unten); ohne den
// EL-Weg wird er laut mit 400 language_unavailable abgelehnt statt still ignoriert.
//
// Reiner Spawn (startServer + seedState), KEIN pglite in derselben Datei (Lehre p6a-Stall).
// Getestet wird der Owner-Pfad (localhost ohne Identitaets-Header -> Tenant Null): die
// flache settings-Form migriert json.load in den Owner-Bucket (wie inbound-routing.test.js),
// die aktive Owner-Nummer ist der Absender. Das deckt die komplette Praezedenz ab, ohne
// den MULTI_TENANT-Pfad zu brauchen (Scope #6: strikt 1 Nummer/Tenant).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_LANGUAGE } from "../src/store/defaults.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const TO = "+4915112345678"; // erlaubtes DE-Ziel (in Allowlist, kein Premium/Notruf)
// Owner-Absendernummer mit FR-Geo-Anker: ersetzt die DE-Default-Owner-Nummer aus dem
// Boot-Guard (ensureOwnerNumber seedet nur, wenn KEINE aktive Owner-Nummer existiert).
const OWNER_FR_NUMBER = "+33123456789";

// Owner-Store mit EINER aktiven Owner-Nummer (gegebener Geo-Anker) + optionalem
// settings-Override. country/language sind die F1-Geo-Felder der Nummer.
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

// Owner-Outbound ueber localhost (kein Identitaets-Header -> Tenant Null). ALLOWED_NUMBERS
// enthaelt das Ziel; Land-Gate neutral (* aus BASE_ENV). Offline-Diskriminator: 500 = alle
// Gates passiert (originateCall wirft ohne TELNYX_API_KEY, s. BASE_ENV in helpers.js).
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

// Wie placeCall, aber MIT explizitem, abweichendem Sprachwunsch im Body - der einzige
// Unterschied, den LANG-15 misst. Eigene Funktion statt Flag-Parameter (F3/G15).
function placeCallWithLanguageWish(srv, language) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", language }),
  });
}

// LANG-15 (tasks/i18n-tests/01-sprachaufloesung.md): AUFGEHOBEN durch Owner-Entscheidung
// F-2 (2026-09-06, PLAN-ANRUFDEFEKTE.md Abschnitt 6). Bis P4a wurde der Sprachwunsch
// serverseitig STILL ignoriert - genau der Defekt W5 (call_mtq08ett4l3o). Ab hier wird er
// NIE mehr still ignoriert: mit ELEVENLABS_OUTBOUND_ENABLED=false (BASE_ENV, dieser Server)
// kann der Wunsch die Offenlegungssprache nicht sicher von der Gespraechssprache trennen
// (D-3, routes/api-calls.js#languageUnavailableBody) - er wird deshalb LAUT mit 400
// language_unavailable abgelehnt statt weiter zu wirken oder zu verschwinden. Kein Anruf,
// kein Datensatz. Der WIRK-Fall (EL-Weg an) hat seinen eigenen Nachbau in
// test/place-call-sprachwahl.test.js (G5, kein zweiter hier).
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

// LANG-26 (tasks/i18n-tests/01-sprachaufloesung.md): Symmetrie-Beweis. Inbound und
// Outbound teilen EINEN Anker (dieselbe aktive Nummer, dieselbe resolveCallLanguage-
// Funktion). Beide Richtungen in EINEM Test, weil genau die GLEICHHEIT das Konzept ist
// (P14) - zwei getrennte Tests koennten beide gruen sein und trotzdem divergieren.
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

// (1) number.language faellt durch auf call.language: FR-Nummer -> Outbound fuehrt FR.
test("Outbound-Sprache = language der eigenen aktiven Nummer (FR-Nummer -> call.language=fr)", async () => {
  const srv = await startServer({ env: ENV, seed: ownerSeed({ numberLanguage: "fr" }) });
  try {
    assert.equal((await placeCall(srv)).status, HTTP_SERVER_ERROR, "Gates passiert -> Offline-Originate (500)");
    assert.equal(outboundCall(srv).language, "fr", "Outbound-Sprache aus number.language (FR)");
  } finally {
    await srv.stop();
  }
});

// (2) Praezedenz #8: settings.language-Override schlaegt number.language (FR-Nummer +
// Override en -> call.language=en). Beweist die Override-Stufe am Outbound.
//
// Traegt zugleich VOICE-08 des i18n-Launch-Testkatalogs (Welle W1, Mechanismus/gruen,
// Spezifikation in tasks/i18n-tests/03-telefonie-render.md): die vierstufige Praezedenz
// settings > number > tenant > default bleibt gepinnt. Der Katalogfall ist durch diesen
// Test und seine Nachbarn in dieser Datei vollstaendig abgedeckt - deshalb EINMAL hier
// (G5) statt als zweite Fassung in einer eigenen Datei.
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

// (3) Letzte Praezedenz-Stufe: Nummer ohne language + ohne Override -> call.language faellt
// auf DEFAULT_LANGUAGE (Weltdefault, P10). Faengt eine ungewollte Verhaltens-Aenderung des
// Default-Pfads - flip-stabil formuliert (gegen DEFAULT_LANGUAGE, nicht gegen "de").
test("Letzte Praezedenz-Stufe: Nummer ohne language -> call.language = Weltdefault", async () => {
  const srv = await startServer({ env: ENV, seed: ownerSeed() }); // weder number.language noch settings.language
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
