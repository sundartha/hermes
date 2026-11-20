import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState, startServer, EL_OUTBOUND_ZUGANG_BOOT_ENV } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";

const HTTP_OK = 200;
const ZIEL = "+4915112345678";
const MANDANT = "t_3394_h2";
const ABSENDER = "+4915799990077";
const SERVER_ENV = Object.freeze({
  ...EL_OUTBOUND_ZUGANG_BOOT_ENV,
  ...vorspannMandantenUmgebung([MANDANT]),
  VOICE_TARIFF_DEFAULT_CENTS: "30",
  VOICE_TARIFF_DOMESTIC_CENTS: "30",
});

const seed = () =>
  seedState({
    tenants: [
      { id: MANDANT, status: "active", kycLevel: "card", ownerName: "Eve Example", country: "DE", defaultLanguage: "de" },
    ],
    numbers: [
      {
        id: "num_3394_h2",
        tenantId: MANDANT,
        e164: ABSENDER,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: "phnum_3394_h2",
        language: "de",
      },
    ],
    profiles: { [MANDANT]: { maxCallsPerHour: 100 } },
  });

async function anrufen(srv, zusatz) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": MANDANT },
    body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren", ...zusatz }),
  });
  return { status: res.status, body: await res.json() };
}

const gespeicherterAnruf = (srv, id) => srv.readStore().calls.find((anruf) => anruf.id === id);

test("Ausgehend: ohne Schalter-Wert startet der Anruf ueber den ElevenLabs-Weg", async () => {
  const srv = await startServer({ seed: seed(), env: SERVER_ENV });
  try {
    const { status, body } = await anrufen(srv, {});
    assert.equal(status, HTTP_OK);
    assert.equal(gespeicherterAnruf(srv, body.callId).costProfile, KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI);
  } finally {
    await srv.stop();
  }
});

test("Ausgehend: ein Sprachwunsch wird angenommen und gilt fuer den Anruf", async () => {
  const srv = await startServer({ seed: seed(), env: SERVER_ENV });
  try {
    const { status, body } = await anrufen(srv, { language: "en" });
    assert.equal(status, HTTP_OK);
    const anruf = gespeicherterAnruf(srv, body.callId);
    assert.equal(anruf.language, "en");
    assert.equal(anruf.costProfile, KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI);
    assert.ok(anruf.openingLine.length > 0);
  } finally {
    await srv.stop();
  }
});

test("Ausgehend: der frueher Schalter genannte Wert ELEVENLABS_OUTBOUND_ENABLED=false aendert nichts mehr", async () => {
  const srv = await startServer({ seed: seed(), env: { ...SERVER_ENV, ELEVENLABS_OUTBOUND_ENABLED: "false" } });
  try {
    const { status, body } = await anrufen(srv, { language: "en" });
    assert.equal(status, HTTP_OK);
    assert.equal(gespeicherterAnruf(srv, body.callId).costProfile, KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI);
  } finally {
    await srv.stop();
  }
});

test("Ausgehend: die Logzeile zur Eroeffnung nennt Quelle und die Zeichenzahl der gespeicherten Eroeffnungszeile", async () => {
  const srv = await startServer({ seed: seed(), env: SERVER_ENV });
  try {
    const { body } = await anrufen(srv, {});
    const zeichen = gespeicherterAnruf(srv, body.callId).openingLine.length;
    assert.match(srv.stdout, new RegExp(`^\\[opening-line\\] quelle=\\S+ zeichen=${zeichen}$`, "m"));
  } finally {
    await srv.stop();
  }
});
