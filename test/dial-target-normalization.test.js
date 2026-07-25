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
  normNum,
  E164,
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
  // OUT-05 (P0, Charakterisierung/heutiger Stand - Ist-Pin-Falle, Regel 5): pinnt
  // BEWUSST das GEFAeHRLICHE Ist-Verhalten (US-Kandidat wird uebersprungen, eine DE/FR-
  // Nummer dahinter gewinnt STILL als "Heimatland"). GAP-25 (SOLL, rot,
  // tasks/i18n-tests/11-luecken-und-e2e.md) formuliert den Sollzustand ("kein stiller
  // Landeswechsel") fuer denselben Sachverhalt - dieser Test ist NICHT der Fix-Beweis,
  // sondern der Regressionsschutz fuer den Ist-Mechanismus, bis GAP-25 behoben wird. Ein
  // spaeterer Fix an homeCountryCode/normalizeDialTarget darf diesen Test AENDERN
  // (nicht als Regression werten), s. Repo-Lehren zu Ist-Pin-Fallen (f1-geo-port.test.js,
  // personal-assistant-characterization.test.js).
  await t.test("erste Trunk-0-Vorwahl gewinnt (Praezedenz der Kandidaten) [Charakterisierung, s. GAP-25]", () => {
    assert.equal(homeCountryCode(["+491737252163"]), "+49");
    assert.equal(homeCountryCode(["+33612345678", "+491737252163"]), "+33");
    // US-DID (kein Trunk-0-Land) wird uebersprungen -> DE-Kandidat dahinter greift.
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"]), "+49");
  });

  // OUT-04 (P0, Charakterisierung/heutiger Stand - s. GAP-25 Hinweis oben): reine
  // +1-Kandidatenlisten liefern fail-closed null (keine Fehlinterpretation), das bleibt
  // Regressionsschutz unabhaengig vom GAP-25-Fix.
  await t.test("kein Trunk-0-Kandidat / Raender -> null (fail-closed) [Charakterisierung, s. GAP-25]", () => {
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

// OUT-06 (P0, Charakterisierung/heutiger Stand - Ist-Pin-Falle, Regel 5, s. GAP-25):
// normNum entfernt nur Trennzeichen, normalizeDialTarget kennt keine NANP-Konvention
// (zehnstellig ohne Praefix, "011"-Auslandsvorwahl statt "00") - beide Faelle bleiben
// unveraendert und scheitern generisch am E.164-Regex (400), ohne NANP-spezifische
// Anleitung. GAP-25 (SOLL, rot) formuliert den Sollzustand fuer denselben Sachverhalt;
// dieser Test ist NICHT der Fix-Beweis, sondern der Regressionsschutz fuer den
// Ist-Mechanismus bis dahin.
test("OUT-06 (Charakterisierung, s. GAP-25): NANP-Schreibweisen werden nicht normalisiert", () => {
  assert.equal(normNum("(212) 555-0123"), "2125550123", "Klammern/Leerzeichen/Bindestrich entfernt");
  assert.equal(normNum("212-555-0123"), "2125550123");

  // Zehnstellig ohne Praefix bleibt UNVERAENDERT - keine +1-Ergaenzung.
  assert.equal(normalizeDialTarget("2125550123", "+1"), "2125550123");
  // "011" (NANP-Auslandsvorwahl) wird NICHT erkannt (nur "00" ist bekannt) -> unveraendert.
  assert.equal(normalizeDialTarget("011491701234567", null), "011491701234567");

  for (const raw of ["2125550123", "011491701234567"]) {
    assert.equal(E164.test(raw), false, `${raw} darf die E.164-Pruefung nicht bestehen`);
  }
});

// GAP-18/25-Nachbar: GAP-25 (P0, SOLL, ROT) - Invariante "kein stiller Landeswechsel bei
// der Wahl-Normalisierung" (tasks/i18n-tests/11-luecken-und-e2e.md). "011" ist im NANP die
// Auslandsvorwahl (Analogon zu "00" in DE/FR/UK); normalizeDialTarget kennt nur "00" und
// faellt fuer "011..."-Eingaben auf die "fuehrende 0"-Regel zurueck - das materialisiert
// FAELSCHLICH eine deutsche Nummer aus einem eigentlich britischen Ziel. Empirisch
// gemessen (2026-07-25, diese Session): normalizeDialTarget("011441234567","+49") ->
// "+4911441234567" (besteht E.164-Regex + Land-Gate bei ALLOWED_COUNTRY_CODES inkl. +49).
// SOLL: die Eingabe bleibt unveraendert (E164-Gate lehnt ab, wie bei jeder anderen
// unerkannten Schreibweise) statt eine falsche Nummer zu erfinden.
test("GAP-25 (SOLL, rot): kein stiller Landeswechsel bei der Wahl-Normalisierung", () => {
  assert.equal(
    normalizeDialTarget("011441234567", "+49"),
    "011441234567",
    "SOLL: NANP-Auslandsvorwahl '011' darf NICHT als fuehrende 0 fehlinterpretiert werden",
  );
  assert.equal(
    normalizeDialTarget("0114155501234", "+49"),
    "0114155501234",
    "SOLL: dito - keine deutsche Nummer aus einer '011'-Eingabe materialisieren",
  );

  // Umgekehrter Fall: eine erkennbare NANP-Schreibweise mit Heimatland +1 SOLL korrekt
  // normalisiert werden (heute: OUT-06 zeigt, dass das nicht passiert).
  assert.equal(normalizeDialTarget("2125550123", "+1"), "+12125550123");
  assert.equal(normalizeDialTarget("1-415-555-0123", "+1"), "+14155550123");
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

// OUT-05b (P0, Charakterisierung/heutiger Stand - Ist-Pin-Falle, Regel 5, s. GAP-25):
// End-to-End-Beweis fuer den in OUT-05 pinnnten Sachverhalt - ein US-Kontext-Tenant
// (US-Privatnummer) mit einer fremden DE-DID waehlt eine fuehrende '0' STILL als
// deutsches Ziel. Der Beweis liegt NICHT im HTTP-Status (500 ist erwartungsgemaess,
// wie jeder andere alle-Gates-passiert-Fall), sondern im TATSAeCHLICH persistierten
// Call-Record: die normalisierte Nummer, die der Provider waehlen wuerde, traegt die
// deutsche Vorwahl - obwohl der Tenant erkennbar im US-Kontext steht. GAP-25 (SOLL,
// rot) fordert, dass genau das NICHT passiert; dieser Test bleibt Regressionsschutz
// fuer den Ist-Mechanismus, bis GAP-25 behoben wird.
test("OUT-05b (Charakterisierung, s. GAP-25): US-Tenant mit fremder DE-DID waehlt fuehrende 0 als stilles DE-Ziel", async (t) => {
  const US_PRIVATE_NUMBER = "+15005550006";
  const FOREIGN_DE_DID = "+491701234567";
  const DE_NATIONAL_TARGET = "01737252163"; // vom Nutzer gemeint als lokale Schreibweise
  const seed = seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: "Jonas",
        ownerName: "Jonas Beispiel",
        privateNumber: US_PRIVATE_NUMBER,
      },
    ],
  });

  await t.test("Ergebnis passiert alle Gates (500) und traegt STILL das falsche +49-Ziel", async () => {
    const srv = await startServer({
      env: { ALLOWED_COUNTRY_CODES: "+1,+49", TWILIO_ACCOUNT_SID: "x" },
      seed,
      ownerNumber: { e164: FOREIGN_DE_DID, provider: "twilio" },
    });
    try {
      const res = await postCall(srv.localUrl, DE_NATIONAL_TARGET);
      assert.equal(res.status, 500, "normalisiertes +49-Ziel passiert ALLE Gates (Ist-Stand)");

      const call = srv
        .readStore()
        .calls.find((c) => c.direction === "outbound" && c.tenantId === BOOTSTRAP_TENANT_ID);
      assert.ok(call, "Call-Record muss angelegt worden sein (VOR dem Offline-Dial-Fehler)");
      assert.equal(
        call.to,
        "+491737252163",
        "der TATSAeCHLICH angelegte Call traegt das stille +49-Ziel, NICHT das vom US-Tenant gemeinte Ziel",
      );
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
