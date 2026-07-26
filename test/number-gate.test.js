// Phase 0: Nummern-Gates fuer Outbound-Calls (Denylist, Laender-Gate,
// Pro-Stunde-Limit) + Pruefreihenfolge. Offline: eine NICHT mit "AC" beginnende
// TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client synchron VOR jedem Netzzugriff
// werfen -> ein durchgelassener Call endet als 500 (= alle Gates passiert), eine
// Sperre als 403/429. Nicht-leer, damit der fail-closed-Boot (OT-4) trotzdem startet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { EMERGENCY_SHORT_CODES } from "../src/telephony/number-denylist.js";

const ALLOWED = "+4915112345678"; // normale DE-Mobilnummer, dient als Positiv-Fall
const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

// ---- 0.1 Denylist (Notruf/Premium, hardcoded) ----
test("Denylist (Notruf-/Premium-/Service-Nummern)", async (t) => {
  // Land + Allowlist grosszuegig: NUR die Denylist kann hier greifen. Nicht-AC
  // TWILIO_ACCOUNT_SID ("x"), damit der Positiv-Fall synchron als 500 endet.
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: ALLOWED, ALLOWED_COUNTRY_CODES: "*", TWILIO_ACCOUNT_SID: "x" },
  });
  try {
    // OUT-10 (P0, i18n-Testkatalog 05-auslandstelefonie.md): "911" muss unabhaengig vom
    // Laender-Gate (hier ALLOWED_COUNTRY_CODES="*") an der Denylist scheitern, VOR jeder
    // Format-/Land-Pruefung - genau das deckt dieser bestehende Testfall bereits ab (911
    // ist eines der vier EMERGENCY_SHORT_CODES). Keine neue Testdatei noetig (G5).
    await t.test("Notruf-Kurzwahlen -> 403 denylist (nicht 400 Format)", async () => {
      for (const to of ["110", "112", "911", "999"]) {
        const res = await postCall(srv.localUrl, to);
        assert.equal(res.status, 403, `${to} muss als Denylist-Sperre abgewiesen werden`);
        assert.match((await res.json()).error, /is blocked/);
      }
    });

    await t.test("DE-Premium-/Service-Prefixe -> 403", async () => {
      for (const to of ["+4990012345678", "+4913712345678", "+4918012345678", "+4911812345678"]) {
        assert.equal((await postCall(srv.localUrl, to)).status, 403, `${to} muss gesperrt sein`);
      }
    });

    await t.test("Satellit-/Intl-Premium-Prefixe -> 403", async () => {
      for (const to of [
        "+87012345678",
        "+88112345678",
        "+88212345678",
        "+88312345678",
        "+97912345678",
      ]) {
        assert.equal((await postCall(srv.localUrl, to)).status, 403, `${to} muss gesperrt sein`);
      }
    });

    await t.test("normale Mobilnummer passiert die Denylist (bis zum naechsten Gate)", async () => {
      // +4915... ist in Allowlist + Land *: alle Gates passieren -> Twilio (offline 500), NICHT 403.
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 500, "normale Nummer darf nicht von der Denylist geblockt werden");
    });
  } finally {
    await srv.stop();
  }
});

// ---- 0.2 Laender-Gate ----
test("Laender-Gate (ALLOWED_COUNTRY_CODES)", async (t) => {
  await t.test("Default +49: +49 passiert, +1 -> 403 grund=land", async () => {
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: ALLOWED, ALLOWED_COUNTRY_CODES: "+49", TWILIO_ACCOUNT_SID: "x" },
    });
    try {
      const blocked = await postCall(srv.localUrl, "+12025550123"); // US
      assert.equal(blocked.status, 403);
      assert.match((await blocked.json()).error, /Country code/);

      const ok = await postCall(srv.localUrl, ALLOWED); // +49 passiert das Land-Gate
      assert.equal(ok.status, 500, "+49 darf das Land-Gate passieren (bis Twilio)");
    } finally {
      await srv.stop();
    }
  });

  // F1 Phase 8: erweitertes Default-Gate +49,+33,+44 (DE/FR/UK). +33 und +44 passieren,
  // ein Ziel ausserhalb der drei Vorwahlen (+1 US) bleibt fail-closed geblockt (R2:
  // das Gate oeffnet bewusst NICHT global).
  await t.test("+49,+33,+44: FR(+33) und UK(+44) passieren, US(+1) -> 403 grund=land", async () => {
    const FR = "+33123456789",
      UK = "+447700900123",
      US = "+12025550123";
    const srv = await startServer({
      // Allowlist grosszuegig (FR/UK/US drin), damit NUR das Land-Gate die drei trennt.
      env: {
        ALLOWED_NUMBERS: `${FR},${UK},${US}`,
        ALLOWED_COUNTRY_CODES: "+49,+33,+44",
        TWILIO_ACCOUNT_SID: "x",
      },
    });
    try {
      assert.equal(
        (await postCall(srv.localUrl, FR)).status,
        500,
        "+33 darf das Land-Gate passieren (bis Twilio)",
      );
      assert.equal(
        (await postCall(srv.localUrl, UK)).status,
        500,
        "+44 darf das Land-Gate passieren (bis Twilio)",
      );

      const blocked = await postCall(srv.localUrl, US); // US ausserhalb der drei Vorwahlen
      assert.equal(blocked.status, 403, "+1 bleibt fail-closed geblockt");
      assert.match((await blocked.json()).error, /Country code/);
    } finally {
      await srv.stop();
    }
  });

  // OUT-02 (P0, hochgestuft von P1 - Live-Messung 07-22, tasks/i18n-tests/13-live-env-
  // befund.md: ALLOWED_COUNTRY_CODES steht LIVE auf "*", nicht auf den Code-Default
  // "+49,+33,+44". Dieser bestehende Testfall prueft bereits genau den real wirksamen
  // Zustand - kein neuer Test noetig (G5), nur die Katalog-Zuordnung dokumentiert.
  await t.test("* erlaubt alle Laender", async () => {
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: "+12025550123", ALLOWED_COUNTRY_CODES: "*", TWILIO_ACCOUNT_SID: "x" },
    });
    try {
      const res = await postCall(srv.localUrl, "+12025550123");
      assert.equal(res.status, 500, "* laesst +1 durch das Land-Gate (bis Twilio)");
    } finally {
      await srv.stop();
    }
  });
});

// OUT-15: der bestehende Notruf-Test oben laeuft mit ALLOWED_COUNTRY_CODES="*" - dort ist
// das Land-Gate ausgeschaltet und beweist die Praezedenz nur schwach. Hier ist genau EIN
// Land explizit erlaubt (+1); die Denylist muss trotzdem VOR Format- und Land-Pruefung
// greifen (403 denylist, nicht 400 Format).
test("OUT-15 (Mechanismus, gruen) - die Notruf-Denylist gewinnt auch bei explizit erlaubtem Land (+1)", async () => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+1", TWILIO_ACCOUNT_SID: "x" },
  });
  try {
    for (const to of EMERGENCY_SHORT_CODES) {
      const res = await postCall(srv.localUrl, to);
      assert.equal(res.status, 403, `${to} muss als Denylist-Sperre abgewiesen werden, nicht als Formatfehler`);
      assert.match((await res.json()).error, /is blocked/, `${to} -> grund=denylist`);
    }
  } finally {
    await srv.stop();
  }
});

// ---- GAP-18: NANP-Sub-Ranges bleiben gesperrt, auch wenn "+1" erlaubt ist ----
// Denylist-Praezedenz (grund=denylist VOR Land-Gate) ist bereits gebaut (s. Pruefreihenfolge-
// Test unten). PREMIUM_PREFIXES enthaelt seit GAP-18 zwoelf "+1"-Eintraege (1-900/1-976 +
// Karibik-Inseln, bekannt fuer Premium-Rueckruf-/One-Ring-Betrug/IRSF) - alle zwoelf
// muessen 403 grund=denylist liefern, auch mit ALLOWED_COUNTRY_CODES="+1".
test("NANP-Sub-Ranges (1-900/1-976 + Karibik) bleiben gesperrt, auch wenn +1 erlaubt ist (GAP-18)", async (t) => {
  const NANP_PREMIUM_TARGETS = [
    "+19005550123", // 1-900 Pay-Per-Call
    "+19765550123", // 1-976 Premium
    "+18095550123", // Dominikanische Republik
    "+18295550123", // Dominikanische Republik
    "+18495550123", // Dominikanische Republik
    "+18765550123", // Jamaika
    "+12685550123", // Antigua und Barbuda
    "+12845550123", // Britische Jungferninseln
    "+14735550123", // Grenada
    "+16495550123", // Turks- und Caicosinseln
    "+16645550123", // Montserrat
    "+17675550123", // Dominica
  ];
  const srv = await startServer({
    env: {
      ALLOWED_NUMBERS: NANP_PREMIUM_TARGETS.join(","),
      ALLOWED_COUNTRY_CODES: "+1",
      TWILIO_ACCOUNT_SID: "x",
    },
  });
  try {
    for (const to of NANP_PREMIUM_TARGETS) {
      await t.test(`${to} -> 403 grund=denylist`, async () => {
        const res = await postCall(srv.localUrl, to);
        assert.equal(res.status, 403, `${to} muss als Denylist-Sperre abgewiesen werden`);
        assert.match((await res.json()).error, /is blocked/);
      });
    }
  } finally {
    await srv.stop();
  }
});

// Pre-Mortem 1 (GAP-18): ein rein negativer Test (nur gesperrte Ziele) kann eine
// Ueberblockierung nicht fangen - dafuer braucht es einen POSITIVEN Gegentest ueber
// echte, gewoehnliche NANP-Nummern in verschiedenen Laendern/Regionen.
test("gewoehnliche NANP-Nummern passieren die Denylist (GAP-18, Ueberblockierungs-Schutz)", async (t) => {
  const ORDINARY_NANP_TARGETS = [
    "+12025550123", // Washington DC
    "+14155550123", // San Francisco
    "+19175550123", // New York City
    "+16045550123", // Vancouver (CA)
    "+18685550123", // Trinidad und Tobago (NANP, aber NICHT gesperrt)
  ];
  const srv = await startServer({
    env: {
      ALLOWED_NUMBERS: ORDINARY_NANP_TARGETS.join(","),
      ALLOWED_COUNTRY_CODES: "+1",
      TWILIO_ACCOUNT_SID: "x",
    },
  });
  try {
    for (const to of ORDINARY_NANP_TARGETS) {
      await t.test(`${to} -> 500 (passiert die Denylist)`, async () => {
        const res = await postCall(srv.localUrl, to);
        assert.equal(res.status, 500, `${to} darf NICHT von der Denylist geblockt werden`);
      });
    }
  } finally {
    await srv.stop();
  }
});

// GAP-18: der Ablehnungsgrund allein sagt nicht, WELCHE Sub-Range gefeuert hat - genau
// das braucht die Forensik, wenn ein ganzes Land still blockiert wird. Direkter Gate-
// Aufruf (Muster test/outbound-gates-order.test.js): das Audit-Detail ist die EINE
// pruefbare Quelle, ohne einen Audit-Log-Reader in test/helpers.js nachzuziehen.
test("Denylist-Audit nennt die getroffene Sub-Range (GAP-18)", async () => {
  const { makeOutboundGates } = await import("../src/telephony/outbound-gates.js");
  const { withConfigNamespaces } = await import("./config-namespaces-helper.js");
  const to = "+19005550123";
  const { gates } = makeOutboundGates({
    store: {
      // P15/T2: die Gate-Kette liest die Anzeigesprache der Ablehnung aus dem Store.
      // Dieser Test prueft nur das sprachfreie Audit-Detail (grund + praefix).
      tenantLanguage: () => "de",
      countOutboundCallsSince: () => 0,
      tenantPrivateNumber: () => null,
      load: () => ({
        numbers: [{ tenantId: "T", status: "active", provider: "twilio", e164: "+1700000000" }],
      }),
      kycReached: () => true,
      tenantContext: () => ({ ownerName: "Alice" }),
      resolveProfile: () => ({
        unrestricted: true,
        allowedCountryCodes: null,
        maxCallsPerHour: null,
        allowedNumbers: [],
      }),
      tenantInactive: () => false,
      tenantActiveSubscriber: () => true,
    },
    config: withConfigNamespaces({ outboundFrozen: false, allowedCountryCodes: ["*"] }),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
  });
  const numberGate = gates.find((g) => g.name === "number_gate");
  const denial = await numberGate.run({ to, tenantId: "T", requestedBy: "owner", profile: {} });
  assert.equal(denial.status, 403);
  assert.equal(denial.audit.detail, `to=${to} grund=denylist praefix=+1900 requestedBy=owner`);
});

// ---- OUT-25 (P0): Vollstaendiger Happy-Path fuer eine korrekt konfigurierte US-Freischaltung ----
// Kombiniert alle Vorbedingungen eines vollstaendig freigeschalteten US-Tenants: +1 im
// Laender-Gate, eine aktive +1-DID als Absendernummer, gueltiges KYC-Level + aktiver
// Subscriber-Status. Der Owner-Pfad erfuellt beides byte-identisch zum Bestand (KYC via
// seedBootstrapKyc auf id_verified beim Boot, Allowlist via tenantActiveSubscriber-Pfad 2 -
// s. test/kyc-gate-outbound.test.js "Flag AUS: Owner-Pfad passiert via Boot-Seed
// id_verified"), NUR mit einer +1-DID statt der Default-US-Testnummer als Absender.
test("OUT-25: vollstaendig freigeschalteter US-Tenant passiert ALLE 17 Gates (500, kein 403/429/400)", async () => {
  const US_TARGET = "+12025550123";
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+1", TWILIO_ACCOUNT_SID: "x" },
    ownerNumber: { e164: "+12025557000", provider: "twilio" },
  });
  try {
    const res = await postCall(srv.localUrl, US_TARGET);
    assert.equal(
      res.status,
      500,
      "vollstaendig freigeschalteter US-Tenant muss ALLE Gates passieren (scheitert erst am Offline-Twilio-Client)",
    );
  } finally {
    await srv.stop();
  }
});

// ---- 0.3 Pro-Stunde-Limit ----
test("Pro-Stunde-Limit (MAX_CALLS_PER_HOUR)", async (t) => {
  const recent = () => new Date().toISOString();
  const env = {
    ALLOWED_NUMBERS: ALLOWED,
    ALLOWED_COUNTRY_CODES: "*",
    MAX_CALLS_PER_HOUR: "2",
    TWILIO_ACCOUNT_SID: "x",
  };

  await t.test("N+1-ter Outbound-Call innerhalb 1h -> 429 grund=stundenlimit", async () => {
    const srv = await startServer({
      env,
      seed: seedState({
        calls: [
          seedCall({ id: "c1", startedAt: recent() }),
          seedCall({ id: "c2", startedAt: recent() }),
        ],
      }),
    });
    try {
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 429);
      assert.match((await res.json()).error, /Hourly limit/);
    } finally {
      await srv.stop();
    }
  });

  await t.test("unter dem Limit passiert das Gate", async () => {
    const srv = await startServer({
      env,
      seed: seedState({ calls: [seedCall({ id: "c1", startedAt: recent() })] }),
    });
    try {
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 500, "1 < Limit 2 -> Gate passiert (bis Twilio)");
    } finally {
      await srv.stop();
    }
  });

  await t.test("Calls aelter als 1h fuellen das Fenster nicht", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const srv = await startServer({
      env,
      seed: seedState({
        calls: [seedCall({ id: "c1", startedAt: old }), seedCall({ id: "c2", startedAt: old })],
      }),
    });
    try {
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 500, "alte Calls zaehlen nicht ins Stundenfenster");
    } finally {
      await srv.stop();
    }
  });

  await t.test("nur Outbound zaehlt, nicht Inbound", async () => {
    const srv = await startServer({
      env,
      seed: seedState({
        calls: [
          seedCall({ id: "i1", direction: "inbound", startedAt: recent() }),
          seedCall({ id: "i2", direction: "inbound", startedAt: recent() }),
        ],
      }),
    });
    try {
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 500, "Inbound-Calls fuellen das Outbound-Stundenfenster nicht");
    } finally {
      await srv.stop();
    }
  });
});

// ---- 0.4 Pruefreihenfolge: Denylist > E.164 > Land > Stundenlimit > Allowlist ----
test("Pruefreihenfolge der Nummern-Gates", async (t) => {
  await t.test("Denylist schlaegt Land + Allowlist", async () => {
    // Premium-Prefix + falsches Land + leere Allowlist -> es muss die Denylist melden.
    const srv = await startServer({ env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+1" } });
    try {
      const res = await postCall(srv.localUrl, "+4990012345678");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /is blocked/);
    } finally {
      await srv.stop();
    }
  });

  await t.test("Land schlaegt Allowlist", async () => {
    const srv = await startServer({ env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49" } });
    try {
      const res = await postCall(srv.localUrl, "+12025550123");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /Country code/);
    } finally {
      await srv.stop();
    }
  });

  // Seit Phase outbound-p1 ist der Owner ein verifizierter Subscriber (Boot-Seed
  // id_verified) und passiert die LEERE statische Allowlist ueber Pfad 2 (tenantActiveSubscriber)
  // -> erreicht den Originate (offline 500). Der fail-closed Verifikations-Riegel fuer einen
  // UNVERIFIZIERTEN Tenant ist jetzt das vorgelagerte KYC-Gate (siehe kyc-gate-outbound.test.js,
  // null-kyc -> 403). Die harten Ziel-Gates (Denylist/Land) bleiben davor (s.o.).
  await t.test("verifizierter Owner/Subscriber passiert die leere Allowlist (Pfad 2 -> 500)", async () => {
    // TWILIO_ACCOUNT_SID "x" (nicht-AC): der Twilio-Client wirft synchron VOR jedem
    // Netzzugriff -> ein durchgelassener Call endet deterministisch offline als 500.
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49", TWILIO_ACCOUNT_SID: "x" },
    });
    try {
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 500, "Owner als Subscriber -> Allowlist-Bypass (Pfad 2), bis Originate");
    } finally {
      await srv.stop();
    }
  });
});

// ---- outbound-p1b: globale Best-effort-IRSF-Blockliste (neue Ranges) ----
// Jeder NEU aufgenommene Premium-/Service-Range muss am DENYLIST-Gate (grund=denylist,
// vor Format/Land) 403 + /gesperrt/ liefern; gewoehnliche internationale Nummern
// (DE-Mobil, US, ES) duerfen die Denylist passieren. Land *, Allowlist grosszuegig,
// TWILIO_ACCOUNT_SID "x" -> ein durchgelassener Call endet offline deterministisch als 500.
test("IRSF-Blockliste: neue Premium-Ranges -> 403, Intl-Mobil passiert (outbound-p1b)", async (t) => {
  const PASS = ["+4915112345678", "+12025550123", "+34600000000"]; // DE-Mobil, US, ES
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: PASS.join(","), ALLOWED_COUNTRY_CODES: "*", TWILIO_ACCOUNT_SID: "x" },
  });
  const blockedByDenylist = async (to) => {
    const res = await postCall(srv.localUrl, to);
    assert.equal(res.status, 403, `${to} muss am Denylist-Gate sperren`);
    assert.match((await res.json()).error, /is blocked/, `${to} muss grund=denylist sein`);
  };
  try {
    await t.test("UK 118/070/09/084x/087x -> 403 denylist", async () => {
      for (const to of [
        "+4411812345678", // 118 Auskunft
        "+447012345678", // 070 Personal/Follow-me
        "+449123456789", // 09 Premium
        "+448431234567",
        "+448441234567",
        "+448451234567", // 084x
        "+448701234567",
        "+448711234567", // 087x
      ])
        await blockedByDenylist(to);
    });

    await t.test("FR 118/089x/081x/082x -> 403 denylist", async () => {
      for (const to of [
        "+3311812345678", // 118 Auskunft
        "+338991234567",
        "+338921234567", // 089x audiotel/SVA
        "+338101234567",
        "+338201234567", // 081x/082x
      ])
        await blockedByDenylist(to);
    });

    await t.test("DE 0900-lang/0700 -> 403 denylist", async () => {
      for (const to of ["+49090012345678", "+4970012345678"]) await blockedByDenylist(to);
    });

    await t.test("gewoehnliche internationale Nummern passieren die Denylist (-> 500)", async () => {
      // In Allowlist + Land *: ALLE Gates inkl. Denylist passieren -> offline 500 (kein 403).
      for (const to of PASS) {
        assert.equal(
          (await postCall(srv.localUrl, to)).status,
          500,
          `${to} darf NICHT von der Denylist geblockt werden`,
        );
      }
    });
  } finally {
    await srv.stop();
  }
});
