import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { EMERGENCY_SHORT_CODES } from "../src/telephony/number-denylist.js";

const ALLOWED = "+4915112345678";
const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("Denylist (Notruf-/Premium-/Service-Nummern)", async (t) => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: ALLOWED, ALLOWED_COUNTRY_CODES: "*" },
  });
  try {
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
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 500, "normale Nummer darf nicht von der Denylist geblockt werden");
    });
  } finally {
    await srv.stop();
  }
});

test("Laender-Gate (ALLOWED_COUNTRY_CODES)", async (t) => {
  await t.test("Default +49: +49 passiert, +1 -> 403 grund=land", async () => {
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: ALLOWED, ALLOWED_COUNTRY_CODES: "+49" },
    });
    try {
      const blocked = await postCall(srv.localUrl, "+12025550123");
      assert.equal(blocked.status, 403);
      assert.match((await blocked.json()).error, /Country code/);

      const ok = await postCall(srv.localUrl, ALLOWED);
      assert.equal(ok.status, 500, "+49 darf das Land-Gate passieren (bis Twilio)");
    } finally {
      await srv.stop();
    }
  });

  await t.test("+49,+33,+44: FR(+33) und UK(+44) passieren, US(+1) -> 403 grund=land", async () => {
    const FR = "+33123456789",
      UK = "+447700900123",
      US = "+12025550123";
    const srv = await startServer({
      env: {
        ALLOWED_NUMBERS: `${FR},${UK},${US}`,
        ALLOWED_COUNTRY_CODES: "+49,+33,+44",
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

      const blocked = await postCall(srv.localUrl, US);
      assert.equal(blocked.status, 403, "+1 bleibt fail-closed geblockt");
      assert.match((await blocked.json()).error, /Country code/);
    } finally {
      await srv.stop();
    }
  });

  await t.test("* erlaubt alle Laender", async () => {
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: "+12025550123", ALLOWED_COUNTRY_CODES: "*" },
    });
    try {
      const res = await postCall(srv.localUrl, "+12025550123");
      assert.equal(res.status, 500, "* laesst +1 durch das Land-Gate (bis Twilio)");
    } finally {
      await srv.stop();
    }
  });
});

test("OUT-15 (Mechanismus, gruen) - die Notruf-Denylist gewinnt auch bei explizit erlaubtem Land (+1)", async () => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+1" },
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

test("NANP-Sub-Ranges (1-900/1-976 + Karibik) bleiben gesperrt, auch wenn +1 erlaubt ist (GAP-18)", async (t) => {
  const NANP_PREMIUM_TARGETS = [
    "+19005550123",
    "+19765550123",
    "+18095550123",
    "+18295550123",
    "+18495550123",
    "+18765550123",
    "+12685550123",
    "+12845550123",
    "+14735550123",
    "+16495550123",
    "+16645550123",
    "+17675550123",
  ];
  const srv = await startServer({
    env: {
      ALLOWED_NUMBERS: NANP_PREMIUM_TARGETS.join(","),
      ALLOWED_COUNTRY_CODES: "+1",
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

test("gewoehnliche NANP-Nummern passieren die Denylist (GAP-18, Ueberblockierungs-Schutz)", async (t) => {
  const ORDINARY_NANP_TARGETS = [
    "+12025550123",
    "+14155550123",
    "+19175550123",
    "+16045550123",
    "+18685550123",
  ];
  const srv = await startServer({
    env: {
      ALLOWED_NUMBERS: ORDINARY_NANP_TARGETS.join(","),
      ALLOWED_COUNTRY_CODES: "+1",
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

test("Denylist-Audit nennt die getroffene Sub-Range (GAP-18)", async () => {
  const { makeOutboundGates } = await import("../src/telephony/outbound-gates.js");
  const { withConfigNamespaces } = await import("./config-namespaces-helper.js");
  const to = "+19005550123";
  const { gates } = makeOutboundGates({
    store: {
      tenantLanguage: () => "de",
      countOutboundCallsSince: () => 0,
      tenantPrivateNumber: () => null,
      load: () => ({
        numbers: [{ tenantId: "T", status: "active", provider: "telnyx", e164: "+1700000000" }],
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

test("OUT-25: vollstaendig freigeschalteter US-Tenant passiert ALLE 17 Gates (500, kein 403/429/400)", async () => {
  const US_TARGET = "+12025550123";
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+1" },
    ownerNumber: { e164: "+12025557000", provider: "telnyx" },
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

test("Pro-Stunde-Limit (MAX_CALLS_PER_HOUR)", async (t) => {
  const recent = () => new Date().toISOString();
  const env = {
    ALLOWED_NUMBERS: ALLOWED,
    ALLOWED_COUNTRY_CODES: "*",
    MAX_CALLS_PER_HOUR: "2",
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
      seed: seedState({ calls: [seedCall({ id: "c1", to: "+4915199999999", startedAt: recent() })] }),
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

test("Pruefreihenfolge der Nummern-Gates", async (t) => {
  await t.test("Denylist schlaegt Land + Allowlist", async () => {
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

  await t.test("verifizierter Owner/Subscriber passiert die leere Allowlist (Pfad 2 -> 500)", async () => {
    const srv = await startServer({
      env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49" },
    });
    try {
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 500, "Owner als Subscriber -> Allowlist-Bypass (Pfad 2), bis Originate");
    } finally {
      await srv.stop();
    }
  });
});

test("IRSF-Blockliste: neue Premium-Ranges -> 403, Intl-Mobil passiert (outbound-p1b)", async (t) => {
  const PASS = ["+4915112345678", "+12025550123", "+34600000000"];
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: PASS.join(","), ALLOWED_COUNTRY_CODES: "*" },
  });
  const blockedByDenylist = async (to) => {
    const res = await postCall(srv.localUrl, to);
    assert.equal(res.status, 403, `${to} muss am Denylist-Gate sperren`);
    assert.match((await res.json()).error, /is blocked/, `${to} muss grund=denylist sein`);
  };
  try {
    await t.test("UK 118/070/09/084x/087x -> 403 denylist", async () => {
      for (const to of [
        "+4411812345678",
        "+447012345678",
        "+449123456789",
        "+448431234567",
        "+448441234567",
        "+448451234567",
        "+448701234567",
        "+448711234567",
      ])
        await blockedByDenylist(to);
    });

    await t.test("FR 118/089x/081x/082x -> 403 denylist", async () => {
      for (const to of [
        "+3311812345678",
        "+338991234567",
        "+338921234567",
        "+338101234567",
        "+338201234567",
      ])
        await blockedByDenylist(to);
    });

    await t.test("DE 0900-lang/0700 -> 403 denylist", async () => {
      for (const to of ["+49090012345678", "+4970012345678"]) await blockedByDenylist(to);
    });

    await t.test("gewoehnliche internationale Nummern passieren die Denylist (-> 500)", async () => {
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

test("KS-P7: Hochpreis-Laendercode (+53 Kuba) -> 403 grund=denylist trotz Land-Gate '*'", async () => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "*" },
  });
  try {
    const res = await postCall(srv.localUrl, "+5352345678");
    assert.equal(res.status, 403, "+53 muss als Denylist-Sperre abgewiesen werden");
    assert.match((await res.json()).error, /is blocked/);
  } finally {
    await srv.stop();
  }
});
