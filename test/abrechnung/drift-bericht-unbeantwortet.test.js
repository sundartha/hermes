import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { tempDataDir } from "../helpers.js";
import { operatorAuthPassThrough } from "../operator-route-app.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { config } from "../../src/config.js";
import { makeBillingRoutes } from "../../src/routes/api-billing.js";

const PRAEFIX = "+49";
const ABSENDER = "+4930555123456";
const MS_JE_MINUTE = 60 * 1000;
const MIKROCENT_JE_CENT = 1_000_000;
const NEUTRALER_KURS = 1_000_000;
const BEWEISENDE_HERKUNFT = "telnyx_detail_records";
const NICHT_BEWEISENDE_HERKUNFT = "unavailable";
const ZU_WENIG_STICHPROBEN = "insufficient_samples";
const UNTERSCHAETZT = "underestimate";

const DRIFT_KONFIG = withConfigNamespaces({
  voiceTariffDomesticPrefixes: [PRAEFIX],
  voiceTariffDomesticCents: 9,
  providerToBucketRateMicro: NEUTRALER_KURS,
  costCalibrationMinSamples: 20,
  costDriftWarnPercent: 50,
});

let store;
let laufendeNummer = 0;

before(async () => {
  config.server.dataDir = tempDataDir();
  store = await import("../../src/store.js");
});

beforeEach(() => {
  store.load().calls.splice(0);
  store.save();
});

function zielnummer() {
  laufendeNummer += 1;
  return `${PRAEFIX}151${String(laufendeNummer).padStart(8, "0")}`;
}

function beendeterAnruf({
  minutenHer,
  angenommenMinuten,
  kostenCent,
  herkunft = BEWEISENDE_HERKUNFT,
}) {
  const anruf = store.createCall({
    direction: "outbound",
    from: ABSENDER,
    to: zielnummer(),
    tenantId: "owner",
    provider: "telnyx",
  });
  const endeMs = Date.now() - minutenHer * MS_JE_MINUTE;
  anruf.status = "completed";
  anruf.endedAt = new Date(endeMs).toISOString();
  if (angenommenMinuten > 0)
    anruf.answeredAt = new Date(endeMs - angenommenMinuten * MS_JE_MINUTE).toISOString();
  store.save();
  store.recordCallCostTruingResult(anruf.id, {
    source: herkunft,
    actualCostMicroCents: kostenCent * MIKROCENT_JE_CENT,
    closedAt: new Date().toISOString(),
  });
  return anruf;
}

async function driftBerichtAbrufen() {
  const app = express();
  app.use(
    makeBillingRoutes({
      config: DRIFT_KONFIG,
      store,
      audit: () => {},
      billing: {},
      tenant: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((fertig) => {
    const laufend = app.listen(0, "127.0.0.1", () => fertig(laufend));
  });
  try {
    const antwort = await abrufMitFrist(
      `http://127.0.0.1:${server.address().port}/api/billing/cost-drift`,
    );
    assert.equal(antwort.status, 200);
    const rohtext = await antwort.text();
    const eintrag = JSON.parse(rohtext).prefixes.find((zeile) => zeile.prefix === PRAEFIX);
    return { eintrag, rohtext };
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

const auszug = ({ samples, code, measuredCentsPerMin }) => ({ samples, code, measuredCentsPerMin });

test("drift: 90 juengste unbeantwortete Anrufe verdraengen die 50 aelteren messbaren nicht", async () => {
  for (let index = 0; index < 90; index++)
    beendeterAnruf({ minutenHer: 10 + index, angenommenMinuten: 0, kostenCent: 0 });
  for (let index = 0; index < 50; index++)
    beendeterAnruf({ minutenHer: 200 + index, angenommenMinuten: 2, kostenCent: 60 });

  const { eintrag } = await driftBerichtAbrufen();
  assert.deepEqual(
    auszug(eintrag),
    { samples: 50, code: UNTERSCHAETZT, measuredCentsPerMin: 30 },
    "Unbeantwortete Anrufe verdrängen Drift-Stichproben",
  );
});

test("drift: bei 120 messbaren Anrufen zaehlen nur die 100 juengsten, die teuren aelteren wirken nicht", async () => {
  for (let index = 0; index < 100; index++)
    beendeterAnruf({ minutenHer: 10 + index, angenommenMinuten: 2, kostenCent: 60 });
  for (let index = 0; index < 20; index++)
    beendeterAnruf({ minutenHer: 500 + index, angenommenMinuten: 2, kostenCent: 600000 });

  const { eintrag } = await driftBerichtAbrufen();
  assert.deepEqual(auszug(eintrag), { samples: 100, code: UNTERSCHAETZT, measuredCentsPerMin: 30 });
});

test("drift: angenommene Anrufe ohne beweisende Kostenherkunft sind keine Stichprobe", async () => {
  for (let index = 0; index < 20; index++)
    beendeterAnruf({
      minutenHer: 10 + index,
      angenommenMinuten: 2,
      kostenCent: 60,
      herkunft: NICHT_BEWEISENDE_HERKUNFT,
    });

  const { eintrag } = await driftBerichtAbrufen();
  assert.deepEqual(auszug(eintrag), {
    samples: 0,
    code: ZU_WENIG_STICHPROBEN,
    measuredCentsPerMin: null,
  });
});

test("drift: 19 messbare Anrufe liegen unter der Mindestzahl 20", async () => {
  for (let index = 0; index < 19; index++)
    beendeterAnruf({ minutenHer: 10 + index, angenommenMinuten: 2, kostenCent: 60 });

  const { eintrag } = await driftBerichtAbrufen();
  assert.deepEqual(auszug(eintrag), {
    samples: 19,
    code: ZU_WENIG_STICHPROBEN,
    measuredCentsPerMin: null,
  });
});

test("drift: die Antwort traegt keine volle Rufnummer, nur den Praefix", async () => {
  const anrufe = [];
  for (let index = 0; index < 25; index++)
    anrufe.push(beendeterAnruf({ minutenHer: 10 + index, angenommenMinuten: 2, kostenCent: 60 }));

  const { rohtext } = await driftBerichtAbrufen();
  for (const anruf of anrufe)
    assert.ok(!rohtext.includes(anruf.to), `volle Rufnummer ${anruf.to} in der Antwort`);
  assert.ok(!rohtext.includes(ABSENDER), "volle Absendernummer in der Antwort");
  assert.ok(rohtext.includes(PRAEFIX), "der Praefix bleibt sichtbar");
});
