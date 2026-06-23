// F1 Phase 8: Outbound-Gespraechssprache aus der EIGENEN aktiven Nummer (Geo-Anker)
// bzw. settings.language-Override. POST /api/calls leitet call.language ueber DIESELBE
// Praezedenz wie Inbound ab (resolveCallLanguage, Owner #8): settings.language ->
// number.language -> tenant.defaultLanguage -> "de". Der historische Call-Body-Param
// b.language wird BEWUSST nicht mehr beruecksichtigt (eine kuratierte Quelle, R8-Geist).
//
// Reiner Spawn (startServer + seedState), KEIN pglite in derselben Datei (Lehre p6a-Stall).
// Getestet wird der Owner-Pfad (localhost ohne Identitaets-Header -> Tenant Null): die
// flache settings-Form migriert json.load in den Owner-Bucket (wie inbound-routing.test.js),
// die aktive Owner-Nummer ist der Absender. Das deckt die komplette Praezedenz ab, ohne
// den MULTI_TENANT-Pfad zu brauchen (Scope #6: strikt 1 Nummer/Tenant).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";

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
    tenantId: OWNER_TENANT_ID,
    provider: "twilio",
    status: "active",
    country: "FR",
  };
  if (numberLanguage) number.language = numberLanguage;
  return seedState({
    settings: settingsLanguage ? { language: settingsLanguage } : {},
    tenants: [{ id: OWNER_TENANT_ID, status: "active" }],
    numbers: [number],
  });
}

// Owner-Outbound ueber localhost (kein Identitaets-Header -> Tenant Null). ALLOWED_NUMBERS
// enthaelt das Ziel; Land-Gate neutral (* aus BASE_ENV), TWILIO_ACCOUNT_SID nicht-AC ("x"),
// damit der durchgelassene Call offline synchron als 500 endet (alle Gates passiert).
function placeCall(srv) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren" }),
  });
}

const ENV = { ALLOWED_NUMBERS: TO, TWILIO_ACCOUNT_SID: "x" };
const outboundCall = (srv) =>
  srv.readStore().calls.find((c) => c.direction === "outbound" && c.to === TO);

// (1) number.language faellt durch auf call.language: FR-Nummer -> Outbound fuehrt FR.
test("Outbound-Sprache = language der eigenen aktiven Nummer (FR-Nummer -> call.language=fr)", async () => {
  const srv = await startServer({ env: ENV, seed: ownerSeed({ numberLanguage: "fr" }) });
  try {
    assert.equal((await placeCall(srv)).status, 500, "Gates passiert -> Offline-Originate (500)");
    assert.equal(outboundCall(srv).language, "fr", "Outbound-Sprache aus number.language (FR)");
  } finally {
    await srv.stop();
  }
});

// (2) Praezedenz #8: settings.language-Override schlaegt number.language (FR-Nummer +
// Override en -> call.language=en). Beweist die Override-Stufe am Outbound.
test("Praezedenz #8: settings.language-Override schlaegt number.language (FR-Nummer + en -> call.language=en)", async () => {
  const srv = await startServer({
    env: ENV,
    seed: ownerSeed({ numberLanguage: "fr", settingsLanguage: "en" }),
  });
  try {
    assert.equal((await placeCall(srv)).status, 500);
    assert.equal(
      outboundCall(srv).language,
      "en",
      "Owner-Override (settings.language=en) schlaegt die FR-Nummer",
    );
  } finally {
    await srv.stop();
  }
});

// (3) DE byte-identisch: Nummer ohne language + ohne Override -> call.language=de (wie
// vor Phase 8). Faengt eine ungewollte Verhaltens-Aenderung des DE-Default-Pfads.
test("DE-Default byte-identisch: Nummer ohne language -> call.language=de", async () => {
  const srv = await startServer({ env: ENV, seed: ownerSeed() }); // weder number.language noch settings.language
  try {
    assert.equal((await placeCall(srv)).status, 500);
    assert.equal(
      outboundCall(srv).language,
      "de",
      "ohne Geo-Anker faellt die Praezedenz auf de (byte-identisch)",
    );
  } finally {
    await srv.stop();
  }
});
