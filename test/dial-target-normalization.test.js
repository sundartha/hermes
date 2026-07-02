// Wurzelfix LLM-Ziffern-Regeneration (RCA call_mr3upd4uz8p3): der MCP-Client reicht
// die Nutzer-Eingabe zeichengenau durch, der Server loest nationale Schreibweisen
// deterministisch auf (Telefon-Konvention: fuehrende 0 = Heimatland des Tenants,
// private Mobilnummer vor eigener DID; "00" -> "+"; "+" unveraendert; kein ableitbares
// Heimatland -> unveraendert -> E.164-Gate 400, ablehnen statt raten).
//
// Zwei Sektionen wie e164-trunk-zero-reject.test.js: (1) reine Helfer (offline,
// deterministisch); (2) der Producer POST /api/calls ueber HTTP. Offline-Diskriminator:
// eine NICHT mit "AC" beginnende TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client
// synchron VOR jedem Netzzugriff werfen -> ein durchgelassener Call endet als 500
// (alle Gates passiert), ein Format-Reject als 400 (Short-Circuit vor createCall).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  homeCountryCode,
  normalizeDialTarget,
  BOOTSTRAP_TENANT_ID,
} from "../src/store/defaults.js";
import { startServer, seedState, OWNER_TEST_NUMBER } from "./helpers.js";

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

// ---- Sektion 1: reine Helfer ----
test("homeCountryCode (Heimatland-Ableitung)", async (t) => {
  await t.test("erste Trunk-0-Vorwahl gewinnt (Praezedenz der Kandidaten)", () => {
    assert.equal(homeCountryCode(["+491737252163"]), "+49");
    assert.equal(homeCountryCode(["+33612345678", "+491737252163"]), "+33");
    // US-DID (kein Trunk-0-Land) wird uebersprungen -> DE-Kandidat dahinter greift.
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"]), "+49");
  });

  await t.test("kein Trunk-0-Kandidat / Raender -> null (fail-closed)", () => {
    assert.equal(homeCountryCode(["+15005550006"]), null);
    assert.equal(homeCountryCode([]), null);
    assert.equal(homeCountryCode([null, undefined, 12345, ""]), null);
    // +39 IT behaelt die fuehrende 0 im NSN -> bewusst KEIN Heimatland fuer die 0-Regel.
    assert.equal(homeCountryCode(["+390612345678"]), null);
  });
});

test("normalizeDialTarget (Telefon-Konvention)", async (t) => {
  await t.test("fuehrende 0 + Heimatland -> Vorwahl ersetzt die 0", () => {
    assert.equal(normalizeDialTarget("01737252163", "+49"), "+491737252163");
    assert.equal(normalizeDialTarget("0612345678", "+33"), "+33612345678");
  });

  await t.test("fuehrende 0 OHNE Heimatland -> unveraendert (E164-Gate lehnt ab)", () => {
    assert.equal(normalizeDialTarget("01737252163", null), "01737252163");
  });

  await t.test("00 -> + (unabhaengig vom Heimatland, Ausland geht immer)", () => {
    assert.equal(normalizeDialTarget("00491737252163", null), "+491737252163");
    assert.equal(normalizeDialTarget("0041791234567", "+49"), "+41791234567");
  });

  await t.test("+ und nicht-praefixte Eingaben unveraendert", () => {
    assert.equal(normalizeDialTarget("+491737252163", "+49"), "+491737252163");
    assert.equal(normalizeDialTarget("491737252163", "+49"), "491737252163");
  });

  await t.test("Raender: Nicht-String -> '', Kurz-Eingaben bleiben E164-ungueltig", () => {
    assert.equal(normalizeDialTarget(null, "+49"), "");
    assert.equal(normalizeDialTarget(undefined, "+49"), "");
    assert.equal(normalizeDialTarget("", "+49"), "");
    assert.equal(normalizeDialTarget("0", "+49"), "+49"); // faellt am E164-Gate (400)
    assert.equal(normalizeDialTarget("00", "+49"), "+"); // dito
  });
});

// ---- Sektion 2: Producer POST /api/calls ueber HTTP ----
const DE_TARGET_E164 = "+491737252163";
const DE_TARGET_NATIONAL = "01737252163";
const HTTP_ENV = {
  ALLOWED_NUMBERS: DE_TARGET_E164,
  ALLOWED_COUNTRY_CODES: "+49",
  TWILIO_ACCOUNT_SID: "x",
};

// Owner-Tenant mit DE-privateNumber, Identitaet wie ensureOwnerIdentity (ownerName
// gesetzt -> Helper laesst den Seed unangetastet); die Owner-DID bleibt der US-Default
// (+15005550006) -> beweist die Praezedenz privateNumber VOR DID.
const seedWithPrivateNumber = seedState({
  tenants: [
    {
      id: BOOTSTRAP_TENANT_ID,
      status: "active",
      firstName: "Jonas",
      ownerName: "Jonas Beispiel",
      privateNumber: DE_TARGET_E164,
    },
  ],
});

test("POST /api/calls: nationale Schreibweise wird deterministisch normalisiert", async (t) => {
  await t.test("privateNumber (DE) vor US-DID -> '01737...' passiert das Format-Gate (500)", async () => {
    const srv = await startServer({ env: HTTP_ENV, seed: seedWithPrivateNumber });
    try {
      const res = await postCall(srv.localUrl, DE_TARGET_NATIONAL);
      assert.equal(res.status, 500, "normalisierte Nummer muss ALLE Gates passieren");
    } finally {
      await srv.stop();
    }
  });

  await t.test("DE-DID als Heimatland-Fallback ohne privateNumber -> 500", async () => {
    const srv = await startServer({
      env: HTTP_ENV,
      ownerNumber: { e164: "+4915799990001", provider: "twilio" },
    });
    try {
      const res = await postCall(srv.localUrl, DE_TARGET_NATIONAL);
      assert.equal(res.status, 500, "DID-Land muss als Fallback greifen");
    } finally {
      await srv.stop();
    }
  });

  await t.test("kein ableitbares Heimatland (US-DID, keine privateNumber) -> 400 statt raten", async () => {
    const srv = await startServer({ env: HTTP_ENV }); // Default-DID +15005550006
    try {
      const res = await postCall(srv.localUrl, DE_TARGET_NATIONAL);
      assert.equal(res.status, 400, "ohne Heimatland darf NICHT geraten werden");
      assert.match((await res.json()).error, /E\.164/);
    } finally {
      await srv.stop();
    }
  });

  await t.test("00-Praefix + Trunk-0-Wiederholungspruefung auf dem Ergebnis", async () => {
    const srv = await startServer({ env: HTTP_ENV, seed: seedWithPrivateNumber });
    try {
      // "0049..." -> "+49..." -> passiert alle Gates (500).
      assert.equal((await postCall(srv.localUrl, `0049${DE_TARGET_NATIONAL.slice(1)}`)).status, 500);
      // "00490173..." -> "+490173..." (Trunk-0 nach Vorwahl) -> 400 (C4-Praedikat
      // auf dem NORMALISIERTEN Ergebnis, nicht nur auf der Roh-Eingabe).
      const res = await postCall(srv.localUrl, `0049${DE_TARGET_NATIONAL}`);
      assert.equal(res.status, 400, "materialisierter Trunk-0 muss abgewiesen werden");
      assert.match((await res.json()).error, /E\.164/);
    } finally {
      await srv.stop();
    }
  });

  await t.test("E.164-Eingabe bleibt byte-identisch behandelt (Bestand)", async () => {
    const srv = await startServer({ env: HTTP_ENV, seed: seedWithPrivateNumber });
    try {
      assert.equal((await postCall(srv.localUrl, DE_TARGET_E164)).status, 500);
    } finally {
      await srv.stop();
    }
  });
});

// OWNER_TEST_NUMBER dokumentiert die Annahme des 400-Falls: der Default-Seed ist
// eine US-Nummer (kein Trunk-0-Land). Bricht das jemand, soll DIESER Test es sagen.
test("Annahme: Default-Owner-Testnummer ist KEIN Trunk-0-Land", () => {
  assert.equal(homeCountryCode([OWNER_TEST_NUMBER.e164]), null);
});
