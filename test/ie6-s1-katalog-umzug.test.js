// IE6-S1: Umzug zweier Katalog-Tests, deren gemessener Pfad mit dem Assistant-Pfad
// entfernt wurde. Beide IDs stehen am Namensanfang und landen damit automatisch in
// npm run test:gates (package.json config.i18nCatalogPattern).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startInboundHarness } from "./helpers/inbound-router-harness.js";
import { localeFor } from "../src/i18n/locales.js";
import { voiceAttrs } from "../src/telephony/adapters/telnyx/render.js";

// GAP-24: der Inbound-Gather traegt den STT-Sprach-Hint des Calls - abgeleitet aus der
// Locale-Quelle (G5), kein Literal. Vorher gegen den Assistant-Speak-Node gemessen; seit
// IE6-S1 gibt es nur noch den TeXML-Gather-Pfad.
test("GAP-24 (Mechanismus, gruen) - der Inbound-Gather traegt den Sprach-Hint des Calls", async () => {
  for (const lang of ["fr", "en"]) {
    const { url, stop } = await startInboundHarness({
      seed: {
        numbers: [
          {
            id: "num_gap24",
            e164: "+4930000000",
            tenantId: "t_bootstrap",
            provider: "telnyx",
            status: "active",
            language: lang,
          },
        ],
      },
    });
    try {
      const res = await fetch(`${url}/voice/incoming`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: "+491700000000", To: "+4930000000", CallSid: "CAgap24" }),
      });
      const xml = await res.text();
      const expected = voiceAttrs(localeFor(lang).voiceProfile).language;
      assert.match(xml, new RegExp(`<Gather\\b[^>]*\\blanguage="${expected}"`), `Sprache ${lang} -> ${expected}`);
    } finally {
      await stop();
    }
  }
});

// OUT-27: der TeXML-Originationspfad reicht das gegatete 'to' unveraendert durch - alles
// Landbezogene (Normalisierung, Denylist, Land-Gate) ist in der Gate-Kette davor
// abgeschlossen ("geprueft == gewaehlt"). Gemessen am VERHALTEN (Spy sieht exakt das
// gegatete to), nicht per grep auf Symbolnamen.
test("OUT-27 (Mechanismus, gruen) - der TeXML-Originationspfad reicht das gegatete 'to' unveraendert durch", async () => {
  // Env VOR dem dynamischen Import (Muster test/sec-p6-gate-fehlerpfad.test.js): die
  // Route beruehrt ueber consult/gate.js und precall-briefing.js den globalen config-
  // Snapshot - ohne dieses Setup entschiede eine lokale .env, ob ein LLM angesprochen wird.
  process.env.PRECALL_BRIEFING_ENABLED = "false";
  process.env.ASSISTANT_CONTEXT_ENABLED = "false";
  process.env.IN_CALL_CONSULT_ENABLED = "false";
  process.env.CONSULT_ENABLED = "false";
  process.env.METRICS_ENABLED = "false";
  const { makeCallRoutes } = await import("../src/routes/api-calls.js");

  for (const to of ["+12025550123", "+491737252163", "01737252163", "011441234567", "2125550123"]) {
    const originateCalls = [];
    const voiceControl = () => ({
      originateCall: async (params) => {
        originateCalls.push(params);
        return { sid: "sid_out27" };
      },
    });
    // EIN Stub-Gate, das ctx VOLLSTAENDIG befuellt (Muster test/sec-p6-gate-fehlerpfad.test.js).
    const outboundGates = [
      {
        name: "stub-fill-ctx",
        run: (ctx) => {
          Object.assign(ctx, {
            to,
            tenantId: "t_out27",
            fromNumber: "+491700000000",
            outboundProvider: "telnyx",
            maxDur: 600,
            reserveCents: 0,
            requestedBy: "test",
            objective: "Test",
            numberRecord: { tenantId: "t_out27" },
          });
          return null;
        },
      },
    ];
    const config = {
      voice: { elevenLabsOutbound: { enabled: false } },
      tenancy: { assistantContextEnabled: false, multiTenant: false },
      server: { publicUrl: "https://agent.test" },
      privacy: { diagnosticRetentionDays: 0 },
    };
    const store = {
      tenantPrivateNumber: () => null,
      resolveProfile: () => ({ allowConsult: false }),
      resolveCallLanguage: () => "de",
      createCall: (felder) => ({ id: "call_out27", ...felder }),
      recordCostProfile: () => {},
      save: () => {},
    };
    const app = express();
    app.use(express.json());
    app.use(
      makeCallRoutes({
        store,
        config,
        audit: () => {},
        outboundGates,
        voiceControl,
        terminateAndBillCall: async () => {},
        hangUpAction: () => null,
        billThunk: () => () => {},
        finishCall: () => {},
        arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
        tenant: {
          requestTenant: () => "t_out27",
          requireTenant: () => "t_out27",
          tenantOwnsCall: () => true,
        },
        consultDelivery: { waitForEvent: async () => ({}) },
        internalIdentity: () => null,
        OWNER_ID: "owner",
      }),
    );
    const server = await new Promise((resolve) => {
      const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
    });
    try {
      await fetch(`http://127.0.0.1:${server.address().port}/api/calls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, objective: "Test" }),
      });
      assert.equal(originateCalls.length, 1, `${to}: genau ein Wahlversuch`);
      assert.equal(originateCalls[0].to, to, `${to} muss unveraendert an den Provider gehen`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
