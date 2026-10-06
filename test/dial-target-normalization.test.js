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

test("homeCountryCode (Heimatland-Ableitung)", async (t) => {
  await t.test("erste bekannte Heimatland-Vorwahl gewinnt (Praezedenz der Kandidaten, GAP-25)", () => {
    assert.equal(homeCountryCode(["+491737252163"]), "+49");
    assert.equal(homeCountryCode(["+33612345678", "+491737252163"]), "+33");
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"], "US"), "+1");
  });

  await t.test("NANP-Kandidat OHNE bestaetigtes Tenant-Herkunftsland wird uebersprungen (Review-Fix Runde 2)", () => {
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"]), "+49");
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"], "DE"), "+49");
    assert.equal(homeCountryCode(["+15005550006", "+491737252163"], null), "+49");
  });

  await t.test("kein bekanntes Wahl-Heimatland -> null (fail-closed)", () => {
    assert.equal(homeCountryCode(["+15005550006"], "US"), "+1");
    assert.equal(homeCountryCode(["+15005550006"]), null, "Review-Fix Runde 2: unbestaetigtes NANP -> null");
    assert.equal(homeCountryCode([]), null);
    assert.equal(homeCountryCode([null, undefined, 12345, ""]), null);
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
    assert.equal(normalizeDialTarget("0", "+49"), "+49");
    assert.equal(normalizeDialTarget("00", "+49"), "+");
  });
});

test("NANP-Schreibweisen: normNum entfernt nur Trennzeichen (OUT-06/GAP-25)", () => {
  assert.equal(normNum("(212) 555-0123"), "2125550123", "Klammern/Leerzeichen/Bindestrich entfernt");
  assert.equal(normNum("212-555-0123"), "2125550123");

  assert.equal(normalizeDialTarget("011491701234567", null), "011491701234567");
  assert.equal(E164.test("011491701234567"), false);
});

test("OUT-17 (Mechanismus, gruen) - normNum bereinigt US-Trennzeichen-Schreibweisen korrekt", () => {
  assert.equal(normNum("+1 (202) 555-0123"), "+12025550123");
  assert.equal(normNum("+1-202-555-0123"), "+12025550123");
  assert.equal(normNum("+12025550123"), "+12025550123", "idempotent auf bereits kanonischer Form");
});

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

  assert.equal(normalizeDialTarget("2125550123", "+1"), "+12125550123");
  assert.equal(normalizeDialTarget("1-415-555-0123", "+1"), "+14155550123");
});

test("NANP-Heimatland: 011/1+10/10 Ziffern werden korrekt aufgeloest", () => {
  assert.equal(normalizeDialTarget("011441234567", "+1"), "+441234567", "011 = NANP-Auslandsvorwahl");
  assert.equal(normalizeDialTarget("14155550123", "+1"), "+14155550123", "1 + 10 Ziffern = nationale Schreibweise");
  assert.equal(normalizeDialTarget("2125550123", "+1"), "+12125550123", "10 Ziffern = blanke Teilnehmernummer");
  assert.equal(normalizeDialTarget("1-415-555-0123", "+1"), "+14155550123", "Trennzeichen werden entfernt");
  assert.equal(normalizeDialTarget("01737252163", "+1"), "01737252163", "unbekannte Form bleibt unveraendert");
});

test("NANP-Heimatland: NPA/NXX-Plausibilitaet wird geprueft statt geraten (Review-Fix Runde 1)", () => {
  assert.equal(normalizeDialTarget("0301234567", "+1"), "0301234567", "NPA darf nicht mit 0 beginnen");
  assert.equal(normalizeDialTarget("1234567890", "+1"), "1234567890", "NPA darf nicht mit 1 beginnen");
  assert.equal(normalizeDialTarget("2101234567", "+1"), "2101234567", "NXX darf nicht mit 0 beginnen");
  assert.equal(normalizeDialTarget("2111234567", "+1"), "2111234567", "NXX darf nicht mit 1 beginnen");
  assert.equal(normalizeDialTarget("10301234567", "+1"), "10301234567", "dito fuer 1+10 Ziffern (NPA)");
  assert.equal(normalizeDialTarget("2125550123", "+1"), "+12125550123");
  assert.equal(normalizeDialTarget("12125550123", "+1"), "+12125550123");
});

test("NANP-Heimatland: '00'-Praefix bleibt die ITU-Auslandsvorwahl (Review-Fix Runde 1)", () => {
  assert.equal(normalizeDialTarget("0049173123456", "+1"), "+49173123456");
  assert.equal(normalizeDialTarget("0044207123456", "+1"), "+44207123456");
  assert.equal(normalizeDialTarget("011441234567", "+1"), "+441234567");
});

test("UK-Ortsnetze 0113-0118 bleiben byte-identisch (K3-Regressionsschutz)", () => {
  assert.equal(normalizeDialTarget("01131234567", "+44"), "+441131234567");
  assert.equal(normalizeDialTarget("01179123456", "+44"), "+441179123456");
  assert.equal(normalizeDialTarget("01181234567", "+44"), "+441181234567");
});

test("DE/FR-Wahlpfad byte-identisch (Bestandskunden unberuehrt)", () => {
  assert.equal(normalizeDialTarget("01737252163", "+49"), "+491737252163");
  assert.equal(normalizeDialTarget("0612345678", "+33"), "+33612345678");
  assert.equal(normalizeDialTarget("0049151234567", "+49"), "+49151234567");
  assert.equal(normalizeDialTarget("011441234567", "+49"), "011441234567", "GAP-25: neu unveraendert");
});

const DE_TARGET_E164 = "+491737252163";
const DE_TARGET_NATIONAL = "01737252163";
const HTTP_ENV = {
  ALLOWED_NUMBERS: DE_TARGET_E164,
  ALLOWED_COUNTRY_CODES: "+49",
};

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
    const srv = await startServer({ env: HTTP_ENV });
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
      assert.equal((await postCall(srv.localUrl, `0049${DE_TARGET_NATIONAL.slice(1)}`)).status, 500);
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
    const srv = await startServer({ seed: seedNanpTenant });
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
    const srv = await startServer({ seed: seedNanpTenant });
    try {
      const res = await postCall(srv.localUrl, "9005550123");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /is blocked/);
    } finally {
      await srv.stop();
    }
  });

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
      const srv = await startServer({ seed: seedEuTenant });
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

test("US-Tenant mit fremder DE-DID waehlt eine fuehrende 0 NICHT mehr als stilles DE-Ziel (OUT-05b/GAP-25)", async (t) => {
  const US_PRIVATE_NUMBER = "+15005550006";
  const FOREIGN_DE_DID = "+491701234567";
  const DE_NATIONAL_TARGET = "01737252163";
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
      env: { ALLOWED_COUNTRY_CODES: "+1,+49" },
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

test("Annahme: Default-Owner-Testnummer ist ein NANP-Heimatland", () => {
  assert.equal(homeCountryCode([OWNER_TEST_NUMBER.e164], "US"), "+1");
});

test("Tenant ohne privateNumber + US-DID: ITU-Wahl geht, unplausible NANP-Form nicht (Review-Fix Runde 1)", async (t) => {
  const HTTP_ENV_ITU = {
    ALLOWED_NUMBERS: DE_TARGET_E164,
    ALLOWED_COUNTRY_CODES: "+1,+49",
  };

  await t.test("'0049...' (ITU-Wahl) passiert alle Gates trotz NANP-Heimatland (500)", async () => {
    const srv = await startServer({ env: HTTP_ENV_ITU });
    try {
      const res = await postCall(srv.localUrl, `0049${DE_TARGET_NATIONAL.slice(1)}`);
      assert.equal(res.status, 500, "die ITU-Wahl muss trotz NANP-Heimatland alle Gates passieren");
    } finally {
      await srv.stop();
    }
  });

  await t.test("10-stellige, NANP-unplausible Eingabe bleibt 400 statt geraten (kein Fremdanruf-Pfad)", async () => {
    const srv = await startServer({ env: HTTP_ENV_ITU });
    try {
      const res = await postCall(srv.localUrl, "0301234567");
      assert.equal(res.status, 400, "eine NANP-unplausible 10-stellige Eingabe darf nicht materialisiert werden");
      assert.match((await res.json()).error, /E\.164/);
    } finally {
      await srv.stop();
    }
  });
});
