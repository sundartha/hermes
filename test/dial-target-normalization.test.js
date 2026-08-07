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
  // OUT-05 (GAP-25, SOLL): NANP (+1) ist ein bekanntes Heimatland (eigene Wahl-
  // Konvention, s. DIALING_HOME_COUNTRY_CODES in store/defaults.js). Review-Fix Runde 2
  // (GAP-25, S1): der NANP-Zweig ist zusaetzlich an das TENANT-Herkunftsland (2. Arg,
  // ISO-3166-1-alpha-2 aus store.tenantGeo) gebunden - eine NANP-foermige Kandidatennummer
  // (z.B. eine US-DID) gilt NUR als Heimatland, wenn der Tenant selbst nachweislich NANP
  // ist. Die Trunk-0-Laender (+49/+33/+44) bleiben UNGUARDED (kein zweiter Parameter noetig).
  await t.test("erste bekannte Heimatland-Vorwahl gewinnt (Praezedenz der Kandidaten, GAP-25)", () => {
    assert.equal(homeCountryCode(["+491737252163"]), "+49");
    assert.equal(homeCountryCode(["+33612345678", "+491737252163"]), "+33");
    // US-DID (NANP) gewinnt VOR dem DE-Kandidaten dahinter - ABER NUR mit bestaetigtem
    // NANP-Tenant-Herkunftsland (Review-Fix Runde 2).
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"], "US"), "+1");
  });

  // Review-Fix Runde 2 (GAP-25, S1): OHNE bestaetigtes NANP-Herkunftsland wird ein
  // NANP-foermiger Kandidat UEBERSPRUNGEN, nicht als Heimatland akzeptiert - der naechste
  // (Trunk-0-)Kandidat gewinnt, falls vorhanden. Das ist die Live-Standardkonstellation aus
  // dem Finding: eine europaeische DID-Zufalls-NANP-Nummer OHNE Tenant-Geo-Bestaetigung darf
  // keinen NANP-Fremdanruf-Pfad oeffnen.
  await t.test("NANP-Kandidat OHNE bestaetigtes Tenant-Herkunftsland wird uebersprungen (Review-Fix Runde 2)", () => {
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"]), "+49");
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"], "DE"), "+49");
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"], null), "+49");
  });

  // FMT-22 (Buchhaltung, kein eigener Test - G5): "homeCountryCode() liefert fuer reinen
  // US-Tenant null" ist seit dem GAP-25-Review-Fix Runde 2 PRAEZISER zu lesen und wird von
  // genau diesem Subtest plus seinem Nachbarn darueber vollstaendig getragen: ohne
  // bestaetigtes NANP-Herkunftsland -> null (hier), mit country="US" -> "+1" (Nachbar).
  //
  // OUT-04 (GAP-25, SOLL): ein reiner +1-Kandidat liefert "+1" NUR mit bestaetigtem
  // NANP-Herkunftsland (Review-Fix Runde 2); ohne Bestaetigung -> null (fail-closed, kein
  // Raten). Laender OHNE bekannte Wahl-Konvention (z.B. +39 IT) bleiben in jedem Fall null.
  await t.test("kein bekanntes Wahl-Heimatland -> null (fail-closed)", () => {
    assert.equal(homeCountryCode(["+15005550006"], "US"), "+1");
    assert.equal(homeCountryCode(["+15005550006"]), null, "Review-Fix Runde 2: unbestaetigtes NANP -> null");
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

// OUT-17 (Positiv-Fall): die uebliche US-Schreibweise MIT Laendervorwahl. Der OUT-06-Test
// darueber deckt nur die Form OHNE "+" ab. Die zweite Haelfte der Katalog-Aussage ("besteht
// danach die E164-Regex") traegt FMT-20 in test/e164-trunk-zero-reject.test.js - hier keine
// zweite Assertion darauf (G5).
test("OUT-17 (Mechanismus, gruen) - normNum bereinigt US-Trennzeichen-Schreibweisen korrekt", () => {
  assert.equal(normNum("+1 (202) 555-0123"), "+12025550123");
  assert.equal(normNum("+1-202-555-0123"), "+12025550123");
  assert.equal(normNum("+12025550123"), "+12025550123", "idempotent auf bereits kanonischer Form");
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

// Review-Fix Runde 1 (GAP-25, S1): NPA/NXX-Plausibilitaet - eine 10-stellige bzw.
// "1"+10-stellige Eingabe, die keine gueltige NANP-Teilnehmernummer sein KANN (NPA/NXX
// muessen mit 2-9 beginnen), darf NICHT klaglos zu einer formal gueltigen +1-Nummer
// materialisiert werden ("ablehnen statt raten"). Ohne diese Pruefung wuerde z.B. eine
// deutsche Ortsnetznummer ohne fuehrende 0 (Anfangsziffer 2-9) einen echten
// Fremdanruf-Pfad oeffnen, den das Format-Gate vorher mit 400 abgewiesen hat.
test("NANP-Heimatland: NPA/NXX-Plausibilitaet wird geprueft statt geraten (Review-Fix Runde 1)", () => {
  // NPA (erste 3 Ziffern) beginnt mit 0 -> keine gueltige NANP-Ortsvorwahl.
  assert.equal(normalizeDialTarget("0301234567", "+1"), "0301234567", "NPA darf nicht mit 0 beginnen");
  // NPA beginnt mit 1 -> ebenfalls ungueltig.
  assert.equal(normalizeDialTarget("1234567890", "+1"), "1234567890", "NPA darf nicht mit 1 beginnen");
  // NXX (Ziffern 4-6) beginnt mit 0/1 -> ungueltig, obwohl die NPA gueltig ist.
  assert.equal(normalizeDialTarget("2101234567", "+1"), "2101234567", "NXX darf nicht mit 0 beginnen");
  assert.equal(normalizeDialTarget("2111234567", "+1"), "2111234567", "NXX darf nicht mit 1 beginnen");
  // Dieselbe Pruefung gilt fuer die "1"+10-Ziffern-Schreibweise.
  assert.equal(normalizeDialTarget("10301234567", "+1"), "10301234567", "dito fuer 1+10 Ziffern (NPA)");
  // Eine gueltige NANP-Nummer bleibt unveraendert materialisierbar (kein False-Positive).
  assert.equal(normalizeDialTarget("2125550123", "+1"), "+12125550123");
  assert.equal(normalizeDialTarget("12125550123", "+1"), "+12125550123");
});

// Review-Fix Runde 1 (GAP-25, S1): explizite Entscheidung fuer den "00"-Praefix bei
// NANP-Heimatland - "00" ist in KEINER NANP-Schreibweise ein gueltiges Praefix (NPA/NXX
// beginnen nie mit 0), also unzweideutig die ITU-Auslandsvorwahl. Ein Tenant OHNE
// privateNumber, dessen aktive DID zufaellig eine NANP-Nummer ist (z.B. ein
// DE/FR-Tenant mit US-DID, s. Finding), darf eine ITU-Wahl weiterhin waehlen - das war
// vor diesem Fix eine Regression gegen den Trunk-0-Pfad (Spezifikations-Zusage
// "byte-identischer Wahlpfad" war fuer genau diese Konstellation verletzt).
test("NANP-Heimatland: '00'-Praefix bleibt die ITU-Auslandsvorwahl (Review-Fix Runde 1)", () => {
  assert.equal(normalizeDialTarget("0049173123456", "+1"), "+49173123456");
  assert.equal(normalizeDialTarget("0044207123456", "+1"), "+44207123456");
  // "011" bleibt weiterhin die NANP-EIGENE Auslandsvorwahl (unveraendert zum Bestand).
  assert.equal(normalizeDialTarget("011441234567", "+1"), "+441234567");
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
      ownerNumber: { e164: "+4915799990001", provider: "telnyx" },
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

  // GAP-25 x GAP-18: beweist die Reihenfolge normalize -> denylist. NANP-Tenant -
  // Review-Fix Runde 2 (S1): das TENANT-Herkunftsland muss die NANP-DID BESTAETIGEN
  // (tenant.country="US" -> store.tenantGeo), sonst wird der DID-Kandidat uebersprungen
  // (s. "NANP-Kandidat OHNE bestaetigtes Tenant-Herkunftsland" oben) und der Test wuerde
  // genau die Live-Standardkonstellation aus dem Finding pruefen (unbestaetigt), nicht den
  // hier gewollten echten NANP-Tenant.
  const seedNanpTenant = seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: "Jonas",
        ownerName: "Jonas Beispiel",
        country: "US",
      },
    ],
  });

  await t.test("NANP-Tenant: 10-stellige Eingabe wird zu +1 und durchlaeuft ALLE Gates", async () => {
    const srv = await startServer({ env: { TWILIO_ACCOUNT_SID: "x" }, seed: seedNanpTenant });
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
    const srv = await startServer({ env: { TWILIO_ACCOUNT_SID: "x" }, seed: seedNanpTenant });
    try {
      const res = await postCall(srv.localUrl, "9005550123");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /is blocked/);
    } finally {
      await srv.stop();
    }
  });

  // Review-Fix Runde 2 (GAP-25, S1): die exakte Live-Standardkonstellation aus dem
  // Finding - ein europaeischer Tenant (tenant.country="DE") OHNE privateNumber, dessen
  // aktive DID zufaellig eine NANP-Nummer ist (frische DIDs sind heute per
  // FORCE_NUMBER_COUNTRY default US). OHNE Tenant-Geo-Bestaetigung wird der DID-Kandidat
  // NICHT als Heimatland akzeptiert -> "8912345678" (NANP-plausibel: NPA=891, NXX=234,
  // beide 2-9) bleibt unveraendert -> das E.164-Gate lehnt ab (400), STATT eine formal
  // gueltige +1-Nummer zu erfinden und einen Fremdanruf-Pfad zu oeffnen (vorher: 500 +
  // persistierter Call to="+18912345678").
  await t.test(
    "Europaeischer Tenant ohne privateNumber + US-DID: unbestaetigte NANP-Form bleibt 400 (Review-Fix Runde 2)",
    async () => {
      const seedEuTenant = seedState({
        tenants: [
          {
            id: BOOTSTRAP_TENANT_ID,
            status: "active",
            firstName: "Jonas",
            ownerName: "Jonas Beispiel",
            country: "DE",
          },
        ],
      });
      const srv = await startServer({ env: { TWILIO_ACCOUNT_SID: "x" }, seed: seedEuTenant });
      try {
        const res = await postCall(srv.localUrl, "8912345678");
        assert.equal(res.status, 400, "kein NANP-Fremdanruf-Pfad ohne bestaetigtes Tenant-Herkunftsland");
        assert.match((await res.json()).error, /E\.164/);
        const call = srv.readStore().calls.find((c) => c.direction === "outbound" && c.to === "+18912345678");
        assert.equal(call, undefined, "kein Call-Record mit dem faelschlich materialisierten NANP-Ziel");
      } finally {
        await srv.stop();
      }
    },
  );
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
  // Review-Fix Runde 2 (S1): country="US" bestaetigt den NANP-Kontext dieses Tenants
  // (store.tenantGeo) - ohne diese Bestaetigung wuerde der homeCountryCode-Guard die
  // NANP-privateNumber uebergehen und stattdessen auf die DE-DID dahinter zurueckfallen
  // (genau der Fehler, den dieser Test verhindern soll).
  const seed = seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: "Jonas",
        ownerName: "Jonas Beispiel",
        privateNumber: US_PRIVATE_NUMBER,
        country: "US",
      },
    ],
  });

  await t.test("Format-Gate lehnt ab (400), KEIN Call-Record mit dem falschen +49-Ziel", async () => {
    const srv = await startServer({
      env: { ALLOWED_COUNTRY_CODES: "+1,+49", TWILIO_ACCOUNT_SID: "x" },
      seed,
      ownerNumber: { e164: FOREIGN_DE_DID, provider: "telnyx" },
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

// OUT-18 (Buchhaltung, kein eigener Test): die Katalog-Aussage "die US-Testnummer bleibt der
// einzige Negativ-/Randfall der Suite" traegt nicht mehr - test/number-gate.test.js fuehrt mit
// "OUT-25: vollstaendig freigeschalteter US-Tenant passiert ALLE 17 Gates" einen gruenen
// US-POSITIV-Pfad. Ein automatisierter Waechter darueber waere eine Aussage ueber die
// Testsuite selbst und altert mit jedem neuen Test (auch mit denen aus W2) - deshalb bleibt
// es bei diesem Anker-Test fuer die Annahme "Default-DID ist NANP".
//
// OWNER_TEST_NUMBER dokumentiert die Annahme: der Default-Seed ist eine US-Nummer
// (NANP-Heimatland, GAP-25) - kein Trunk-0-Land, aber seit GAP-25 ein bekanntes
// NANP-Heimatland (mit bestaetigtem NANP-Tenant-Herkunftsland, Review-Fix Runde 2 - ohne
// Bestaetigung liefert derselbe Kandidat seit Runde 2 null, s. Test oben). Bricht das
// jemand, soll DIESER Test es sagen.
test("Annahme: Default-Owner-Testnummer ist ein NANP-Heimatland", () => {
  assert.equal(homeCountryCode([OWNER_TEST_NUMBER.e164], "US"), "+1");
});

// Review-Fix Runde 1 (GAP-25, S1): End-to-End-Beweis fuer die Live-Standardkonstellation
// aus dem Finding - ein Tenant OHNE privateNumber, dessen aktive DID zufaellig eine
// NANP-Nummer ist (frische DIDs sind heute US-Nummern, s. self-service-routes.js).
// homeCountryCode liefert fuer diesen Tenant "+1" (NANP), obwohl der Nutzer selbst nach
// ITU-Konvention waehlt.
test("Tenant ohne privateNumber + US-DID: ITU-Wahl geht, unplausible NANP-Form nicht (Review-Fix Runde 1)", async (t) => {
  const HTTP_ENV_ITU = {
    ALLOWED_NUMBERS: DE_TARGET_E164,
    ALLOWED_COUNTRY_CODES: "+1,+49",
    TWILIO_ACCOUNT_SID: "x",
  };

  await t.test("'0049...' (ITU-Wahl) passiert alle Gates trotz NANP-Heimatland (500)", async () => {
    const srv = await startServer({ env: HTTP_ENV_ITU }); // Default-DID +15005550006 (NANP), keine privateNumber
    try {
      const res = await postCall(srv.localUrl, `0049${DE_TARGET_NATIONAL.slice(1)}`);
      assert.equal(res.status, 500, "die ITU-Wahl muss trotz NANP-Heimatland alle Gates passieren");
    } finally {
      await srv.stop();
    }
  });

  await t.test("10-stellige, NANP-unplausible Eingabe bleibt 400 statt geraten (kein Fremdanruf-Pfad)", async () => {
    const srv = await startServer({ env: HTTP_ENV_ITU }); // Default-DID +15005550006 (NANP), keine privateNumber
    try {
      // NPA beginnt mit "0" - keine gueltige NANP-Ortsvorwahl, darf NICHT zu +1... werden.
      const res = await postCall(srv.localUrl, "0301234567");
      assert.equal(res.status, 400, "eine NANP-unplausible 10-stellige Eingabe darf nicht materialisiert werden");
      assert.match((await res.json()).error, /E\.164/);
    } finally {
      await srv.stop();
    }
  });
});
