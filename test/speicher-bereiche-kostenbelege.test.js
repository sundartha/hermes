import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { speicherBereiche } from "../src/store.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const ANRUF = "call_kostenbelege_1";

const KOSTENBELEGE = [
  ["callCostEvidence", [ANRUF], [{ traeger: "elevenlabs_convai" }]],
  ["recordCallCostEvidence", [{ callId: ANRUF, traeger: "telnyx_sip" }], { evidence: { id: 1 } }],
  ["markCostCrossCheckAttempted", ["2026-07"], { attempted: true }],
];

const TTS = [["platformTtsUsageView", ["2026-08-15T12:00:00.000Z"], { characters: 7, quota: 100 }]];

function attrappe(tabelle) {
  const aufrufe = [];
  const speicher = {};
  for (const [name, , ergebnis] of tabelle) {
    speicher[name] = (...args) => {
      aufrufe.push([name, ...args]);
      return ergebnis;
    };
  }
  return { speicher, aufrufe };
}

for (const [bereich, tabelle] of [
  ["kostenbelege", KOSTENBELEGE],
  ["tts", TTS],
]) {
  test(`${bereich}: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion`, async () => {
    const { speicher, aufrufe } = attrappe(tabelle);
    const funktionen = speicherBereiche(speicher)[bereich];
    assert.deepEqual(Object.keys(funktionen), tabelle.map(([name]) => name));
    for (const [name, args, ergebnis] of tabelle) {
      const antwort = funktionen[name](...args);
      assert.ok(antwort instanceof Promise, name);
      assert.deepEqual(await antwort, ergebnis, name);
    }
    assert.deepEqual(aufrufe, tabelle.map(([name, args]) => [name, ...args]));
  });

  test(`${bereich}: Speicherfunktionen werden erst beim Aufruf gelesen und ein Wurf wird zur Ablehnung`, async () => {
    const { speicher } = attrappe(tabelle);
    const funktionen = speicherBereiche(speicher)[bereich];
    const [[name, args]] = tabelle;
    speicher[name] = () => "spaet";
    assert.equal(await funktionen[name](...args), "spaet");
    speicher[name] = () => {
      throw new Error("kaputt");
    };
    await assert.rejects(funktionen[name](...args), /kaputt/);
  });
}

async function starteKosten(store) {
  const app = express();
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({
        billing: {
          numberMonthlyCostCents: 92,
          platformFixedCostUsdCentsPerMonth: 600,
          providerToBucketRateMicro: 920000,
          ttsCharacterQuota: 39981,
          ttsCharacterQuotaWarnPercent: 0,
          ttsQuotaCycleAnchorDay: 1,
        },
      }),
      store,
      audit: () => {},
      billing: {},
      tenant: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("Plattformkosten: ein Wurf der Kontingent-Ansicht wird zum Serverfehler statt zum haengenden Aufruf", async () => {
  const app = await starteKosten({
    load: () => ({ numbers: [] }),
    platformTtsUsageView: () => {
      throw new Error("ansicht kaputt");
    },
  });
  try {
    const antwort = await abrufMitFrist(`${app.base}/api/billing/platform-costs`);
    assert.equal(antwort.status, 500);
  } finally {
    await app.close();
  }
});
