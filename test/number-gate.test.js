// Phase 0: Nummern-Gates fuer Outbound-Calls (Denylist, Laender-Gate,
// Pro-Stunde-Limit) + Pruefreihenfolge. Offline: eine NICHT mit "AC" beginnende
// TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client synchron VOR jedem Netzzugriff
// werfen -> ein durchgelassener Call endet als 500 (= alle Gates passiert), eine
// Sperre als 403/429. Nicht-leer, damit der fail-closed-Boot (OT-4) trotzdem startet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

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
      for (const to of ["+87012345678", "+88112345678", "+88212345678", "+88312345678", "+97912345678"]) {
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
    const FR = "+33123456789", UK = "+447700900123", US = "+12025550123";
    const srv = await startServer({
      // Allowlist grosszuegig (FR/UK/US drin), damit NUR das Land-Gate die drei trennt.
      env: { ALLOWED_NUMBERS: `${FR},${UK},${US}`, ALLOWED_COUNTRY_CODES: "+49,+33,+44", TWILIO_ACCOUNT_SID: "x" },
    });
    try {
      assert.equal((await postCall(srv.localUrl, FR)).status, 500, "+33 darf das Land-Gate passieren (bis Twilio)");
      assert.equal((await postCall(srv.localUrl, UK)).status, 500, "+44 darf das Land-Gate passieren (bis Twilio)");

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
  const env = { ALLOWED_NUMBERS: ALLOWED, ALLOWED_COUNTRY_CODES: "*", MAX_CALLS_PER_HOUR: "2", TWILIO_ACCOUNT_SID: "x" };

  await t.test("N+1-ter Outbound-Call innerhalb 1h -> 429 grund=stundenlimit", async () => {
    const srv = await startServer({
      env,
      seed: seedState({ calls: [seedCall({ id: "c1", startedAt: recent() }), seedCall({ id: "c2", startedAt: recent() })] }),
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
      seed: seedState({ calls: [seedCall({ id: "c1", startedAt: old }), seedCall({ id: "c2", startedAt: old })] }),
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

  await t.test("Allowlist bleibt das letzte Gate (leer -> 403 gesperrt)", async () => {
    const srv = await startServer({ env: { ALLOWED_NUMBERS: "", ALLOWED_COUNTRY_CODES: "+49" } });
    try {
      const res = await postCall(srv.localUrl, ALLOWED);
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /Allowlist/);
    } finally {
      await srv.stop();
    }
  });
});
