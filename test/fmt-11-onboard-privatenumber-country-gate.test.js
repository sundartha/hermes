// FMT-11 (i18n-Testkatalog, tasks/i18n-tests/10-zeit-format-daten.md:284) - Private
// Summary-Nummer: ein US-Land-Tenant bekommt beim Onboarding trotzdem nur das +49-Gate.
//
// P8 A3-Migration: dieser Test war "SOLL (rot)". Mit P8 (allowedPrivateNumberCodes leitet
// das erlaubte Praefix aus country her; api-onboard.js reicht country jetzt an
// normalizePrivateNumber durch) ist der Zielzustand erreicht - der Test wandert von
// test:gates nach npm test.
//
// Eigene Datei (kein Edit an test/onboarding-route.test.js, Datei-Eigentum Block B6):
// gleiches Muster (startServer, postJson) wie dort (S1-9a/b).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Onboarding: country=US + passende +1-Nummer passiert das private-Nummer-Gate (ex FMT-11)", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, {
      tenantId: "t_fmt11",
      country: "US",
      privateNumber: "+12025550123",
    });
    const json = await res.json();
    assert.notEqual(
      res.status,
      400,
      `country=US + passende +1-Nummer darf nicht am +49-Default-Gate scheitern (war ${res.status}, error=${json?.error})`,
    );
  } finally {
    await srv.stop();
  }
});
