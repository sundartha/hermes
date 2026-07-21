// Phase 0: Nummern-Gates fuer Outbound-Calls (Denylist, Laender-Gate,
// Pro-Stunde-Limit) + Pruefreihenfolge. Offline: eine NICHT mit "AC" beginnende
// TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client synchron VOR jedem Netzzugriff
// werfen -> ein durchgelassener Call endet als 500 (= alle Gates passiert), eine
// Sperre als 403/429. Nicht-leer, damit der fail-closed-Boot (OT-4) trotzdem startet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

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
    await t.test("Notruf-Kurzwahlen -> 403 denylist (nicht 400 Format)", async () => {
      for (const to of ["110", "112", "911", "999"]) {
        const res = await postCall(srv.localUrl, to);
        assert.equal(res.status, 403, `${to} muss als Denylist-Sperre abgewiesen werden`);
        assert.match((await res.json()).error, /gesperrt/);
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
      assert.match((await blocked.json()).error, /Laendervorwahl/);

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
      assert.match((await blocked.json()).error, /Laendervorwahl/);
    } finally {
      await srv.stop();
    }
  });

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
      assert.match((await res.json()).error, /Stundenlimit/);
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
      assert.match((await res.json()).error, /gesperrt/);
    } finally {
      await srv.stop();
    }
  });

  await t.test("Land schlaegt Allowlist", async () => {
    const srv = await startServer({ env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49" } });
    try {
      const res = await postCall(srv.localUrl, "+12025550123");
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /Laendervorwahl/);
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
    assert.match((await res.json()).error, /gesperrt/, `${to} muss grund=denylist sein`);
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

// ---- OUT-07 (PLAN-LAUNCH-TESTS.md Erweiterung) ----
// Alle anderen Faelle von OUT-07 (Notruf-Kurzwahlen exakt, Land ausserhalb
// ALLOWED_COUNTRY_CODES) sind oben bereits abgedeckt (0.1/0.2). Was noch fehlte: eine
// Premium-Nummer in NATIONALER Schreibweise (fuehrende 0), die ERST durch die Trunk-0-
// Normalisierung (privateNumber-Praezedenz, siehe dial-target-normalization.test.js) zu
// ihrer vollen E.164-Form wird - deckt die Reihenfolge "normalisieren DANN Denylist"
// end-to-end ab, nicht nur mit schon-E.164-Premium-Nummern wie oben.
test("OUT-07: Premium-Nummer in nationaler Schreibweise wird normalisiert UND landet am Denylist-Gate (403), nicht am Format-Gate (400)", async (t) => {
  const DE_PRIVATE_NUMBER = "+491737252163"; // ermoeglicht Trunk-0-Aufloesung (Heimatland DE)
  const seedWithPrivateNumber = seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: "Jonas",
        ownerName: "Jonas Beispiel",
        privateNumber: DE_PRIVATE_NUMBER,
      },
    ],
  });

  await t.test("'090012345678' (national) -> normalisiert zu '+4990012345678' -> 403 denylist", async () => {
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: ALLOWED, ALLOWED_COUNTRY_CODES: "*", TWILIO_ACCOUNT_SID: "x" },
      seed: seedWithPrivateNumber,
    });
    try {
      const res = await postCall(srv.localUrl, "090012345678");
      assert.equal(res.status, 403, "normalisierte Premium-Nummer muss am Denylist-Gate sperren, NICHT 400/500");
      assert.match((await res.json()).error, /gesperrt/, "grund=denylist, nicht ein Format-/Netzfehler");
    } finally {
      await srv.stop();
    }
  });

  await t.test("Kontrastfall: dieselbe normale Nummer national eingegeben passiert bis Twilio (500)", async () => {
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: ALLOWED, ALLOWED_COUNTRY_CODES: "*", TWILIO_ACCOUNT_SID: "x" },
      seed: seedWithPrivateNumber,
    });
    try {
      const res = await postCall(srv.localUrl, "01737252164"); // normale Mobilnummer, national
      assert.equal(res.status, 500, "normalisierte NICHT-Premium-Nummer darf die Denylist passieren");
    } finally {
      await srv.stop();
    }
  });
});
