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
  // OUT-05 (GAP-25, SOLL): NANP (+1) ist jetzt ein bekanntes Heimatland (eigene
  // Wahl-Konvention, s. DIALING_HOME_COUNTRY_CODES in store/defaults.js) - ein
  // US-Kandidat wird NICHT mehr uebersprungen. Frueher gewann still der DE/FR-Kandidat
  // dahinter (der stille Landeswechsel aus OUT-05/OUT-05b); das ist mit diesem Fix
  // ausgeschlossen.
  await t.test("erste bekannte Heimatland-Vorwahl gewinnt (Praezedenz der Kandidaten, GAP-25)", () => {
    assert.equal(homeCountryCode(["+491737252163"]), "+49");
    assert.equal(homeCountryCode(["+33612345678", "+491737252163"]), "+33");
    // US-DID (NANP, jetzt bekanntes Heimatland) gewinnt VOR dem DE-Kandidaten dahinter.
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"]), "+1");
  });

  // OUT-04 (GAP-25, SOLL): reine +1-Kandidaten liefern jetzt "+1" (NANP ist ein
  // bekanntes Heimatland). Nur Laender OHNE bekannte Wahl-Konvention (z.B. +39 IT)
  // bleiben null (fail-closed - kein Raten).
  await t.test("kein bekanntes Wahl-Heimatland -> null (fail-closed)", () => {
    assert.equal(homeCountryCode(["+15005550006"]), "+1");
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

// OUT-06 (GAP-25): normNum entfernt nur Trennzeichen - das bleibt unveraendert (G5,
// dieselbe Quelle wie vorher). normalizeDialTarget("011491701234567", null) bleibt
// ebenfalls unveraendert: OHNE Heimatland (homeCountry !== "+1") greift der NANP-Zweig
// gar nicht erst, der Trunk-0-Zweig kennt "011" nur als Ausnahme-Praedikat, nicht als
// eigene Auslandsvorwahl.
test("NANP-Schreibweisen: normNum entfernt nur Trennzeichen (OUT-06/GAP-25)", () => {
  assert.equal(normNum("(212) 555-0123"), "2125550123", "Klammern/Leerzeichen/Bindestrich entfernt");
  assert.equal(normNum("212-555-0123"), "2125550123");

  // Ohne ableitbares NANP-Heimatland bleibt "011..." unveraendert (E164-Gate lehnt ab).
  assert.equal(normalizeDialTarget("011491701234567", null), "011491701234567");
  assert.equal(E164.test("011491701234567"), false);
});

// GAP-18/25-Nachbar: Invariante "kein stiller Landeswechsel bei der Wahl-Normalisierung"
// (tasks/i18n-tests/11-luecken-und-e2e.md). "011" ist im NANP die Auslandsvorwahl
// (Analogon zu "00" in DE/FR/UK); der Trunk-0-Zweig wuerde "011..." sonst als fuehrende
// 0 fehlinterpretieren und FAELSCHLICH eine deutsche Nummer aus einem eigentlich
// britischen Ziel materialisieren. SOLL (jetzt umgesetzt): die Eingabe bleibt
// unveraendert (E164-Gate lehnt ab, wie bei jeder anderen unerkannten Schreibweise)
// statt eine falsche Nummer zu erfinden.
test("kein stiller Landeswechsel bei der Wahl-Normalisierung (GAP-25)", () => {
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

  // Umgekehrter Fall: eine erkennbare NANP-Schreibweise mit Heimatland +1 wird korrekt
  // normalisiert (OUT-06 zeigt weiterhin die reine normNum-Trennzeichen-Entfernung).
  assert.equal(normalizeDialTarget("2125550123", "+1"), "+12125550123");
  assert.equal(normalizeDialTarget("1-415-555-0123", "+1"), "+14155550123");
});

// Neuer Unit-Test (GAP-25): der NANP-Zweig loest alle drei Wahl-Schreibweisen korrekt auf.
test("NANP-Heimatland: 011/1+10/10 Ziffern werden korrekt aufgeloest", () => {
  assert.equal(normalizeDialTarget("011441234567", "+1"), "+441234567", "011 = NANP-Auslandsvorwahl");
  assert.equal(normalizeDialTarget("14155550123", "+1"), "+14155550123", "1 + 10 Ziffern = nationale Schreibweise");
  assert.equal(normalizeDialTarget("2125550123", "+1"), "+12125550123", "10 Ziffern = blanke Teilnehmernummer");
  assert.equal(normalizeDialTarget("1-415-555-0123", "+1"), "+14155550123", "Trennzeichen werden entfernt");
  assert.equal(normalizeDialTarget("01737252163", "+1"), "01737252163", "unbekannte Form bleibt unveraendert");
});

// K3-Regressionsschutz: britische Ortsnetze 0113-0118 (Leeds/Sheffield/Nottingham/
// Leicester/Bristol/Reading) sind KEINE Kurzwahl-Gasse - der +44-Wahlpfad bleibt
// byte-identisch zum Bestand (NO_NATIONAL_ELEVEN_RANGE_COUNTRIES enthaelt +44 NICHT).
test("UK-Ortsnetze 0113-0118 bleiben byte-identisch (K3-Regressionsschutz)", () => {
  assert.equal(normalizeDialTarget("01131234567", "+44"), "+441131234567");
  assert.equal(normalizeDialTarget("01179123456", "+44"), "+441179123456");
  assert.equal(normalizeDialTarget("01181234567", "+44"), "+441181234567");
});

// DE/FR-Wahlpfad bleibt byte-identisch (Bestandskunden unberuehrt) - nur "011..." bleibt
// dort neu unveraendert stehen (GAP-25), alles andere byte-identisch zum Bestand.
test("DE/FR-Wahlpfad byte-identisch (Bestandskunden unberuehrt)", () => {
  assert.equal(normalizeDialTarget("01737252163", "+49"), "+491737252163");
  assert.equal(normalizeDialTarget("0612345678", "+33"), "+33612345678");
  assert.equal(normalizeDialTarget("0049151234567", "+49"), "+49151234567");
  assert.equal(normalizeDialTarget("011441234567", "+49"), "011441234567", "GAP-25: neu unveraendert");
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

  await t.test("US-Heimatland kennt keine fuehrende 0 (NANP-DID, keine privateNumber) -> 400 statt raten", async () => {
    const srv = await startServer({ env: HTTP_ENV }); // Default-DID +15005550006 (NANP)
    try {
      const res = await postCall(srv.localUrl, DE_TARGET_NATIONAL);
      assert.equal(res.status, 400, "eine fuehrende 0 ist im NANP-Heimatland keine gueltige Schreibweise");
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

  // GAP-25 x GAP-18: beweist die Reihenfolge normalize -> denylist. NANP-Tenant
  // (OWNER_TEST_NUMBER, Default-DID +15005550006), keine privateNumber -> homeCountry
  // "+1" (GAP-25).
  await t.test("NANP-Tenant: 10-stellige Eingabe wird zu +1 und durchlaeuft ALLE Gates", async () => {
    const srv = await startServer({ env: { TWILIO_ACCOUNT_SID: "x" } });
    try {
      const res = await postCall(srv.localUrl, "2125550123");
      assert.equal(res.status, 500, "normalisiertes +1-Ziel muss ALLE Gates passieren");
      const call = srv.readStore().calls.find((c) => c.direction === "outbound");
      assert.equal(call?.to, "+12125550123", "der persistierte Call traegt die normalisierte NANP-Nummer");
    } finally {
      await srv.stop();
    }
  });

  await t.test("NANP-Tenant: 9005550123 wird zu +1900... und dort von der Denylist gestoppt", async () => {
    const srv = await startServer({ env: { TWILIO_ACCOUNT_SID: "x" } });
    try {
      const res = await postCall(srv.localUrl, "9005550123");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /gesperrt/);
    } finally {
      await srv.stop();
    }
  });
});

// OUT-05b (GAP-25, SOLL): End-to-End-Beweis fuer den in OUT-05 gefixten Sachverhalt -
// ein US-Kontext-Tenant (US-Privatnummer) mit einer fremden DE-DID waehlt eine fuehrende
// '0' NICHT MEHR als deutsches Ziel. privateNumber (NANP) gewinnt jetzt als Heimatland
// (Praezedenz VOR der DID) und die "fuehrende 0" ist im NANP keine gueltige Schreibweise
// -> das Format-Gate lehnt ab (400), statt still eine deutsche Nummer zu erfinden. Der
// Beweis liegt NICHT im HTTP-Status allein, sondern zusaetzlich im NICHT persistierten
// Call-Record: es entsteht KEIN Call mit dem falschen +49-Ziel.
test("US-Tenant mit fremder DE-DID waehlt eine fuehrende 0 NICHT mehr als stilles DE-Ziel (OUT-05b/GAP-25)", async (t) => {
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

  await t.test("Format-Gate lehnt ab (400), KEIN Call-Record mit dem falschen +49-Ziel", async () => {
    const srv = await startServer({
      env: { ALLOWED_COUNTRY_CODES: "+1,+49", TWILIO_ACCOUNT_SID: "x" },
      seed,
      ownerNumber: { e164: FOREIGN_DE_DID, provider: "twilio" },
    });
    try {
      const res = await postCall(srv.localUrl, DE_NATIONAL_TARGET);
      assert.equal(res.status, 400, "SOLL: eine fuehrende 0 im NANP-Heimatland faellt am E.164-Gate");

      const call = srv
        .readStore()
        .calls.find((c) => c.direction === "outbound" && c.tenantId === BOOTSTRAP_TENANT_ID && c.to === "+491737252163");
      assert.equal(
        call,
        undefined,
        "SOLL: kein Call-Record mit dem falschen +49-Ziel - GAP-25 verhindert den stillen Landeswechsel",
      );
    } finally {
      await srv.stop();
    }
  });
});

// OWNER_TEST_NUMBER dokumentiert die Annahme: der Default-Seed ist eine US-Nummer
// (NANP-Heimatland, GAP-25) - kein Trunk-0-Land, aber seit GAP-25 ein bekanntes
// NANP-Heimatland. Bricht das jemand, soll DIESER Test es sagen.
test("Annahme: Default-Owner-Testnummer ist ein NANP-Heimatland", () => {
  assert.equal(homeCountryCode([OWNER_TEST_NUMBER.e164]), "+1");
});
