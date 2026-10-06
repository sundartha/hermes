import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, externalIp, seedState } from "./helpers.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { platformTtsUsageView, makeDefaultState } from "../src/store/state-ops.js";
import { countActiveNumbers } from "../src/store/views.js";
import { BOOTSTRAP_TENANT_ID, NUMBER_STATUS, emptyPlatformTtsUsage } from "../src/store/defaults.js";

const EXTERNAL_IP = externalIp();

const NUMBER_MONTHLY_COST_CENTS = 92;
const PLATFORM_FIXED_COST_USD_CENTS = 600;
const ELEVENLABS_EUR_CENTS = 552;
const PROVIDER_TO_BUCKET_RATE_MICRO = 920000;
const TTS_CHARACTER_QUOTA = 39981;
const TTS_WARN_PERCENT = 0;

const PLATFORM_COSTS_CONFIG = withConfigNamespaces({
  numberMonthlyCostCents: NUMBER_MONTHLY_COST_CENTS,
  platformFixedCostUsdCentsPerMonth: PLATFORM_FIXED_COST_USD_CENTS,
  providerToBucketRateMicro: PROVIDER_TO_BUCKET_RATE_MICRO,
  ttsCharacterQuota: TTS_CHARACTER_QUOTA,
  ttsCharacterQuotaWarnPercent: TTS_WARN_PERCENT,
  ttsQuotaCycleAnchorDay: 1,
});

const PII_PHONE = "+4915155599999";
const PII_TENANT = "kunde-pii-klarname";

async function startPlatformCostsApp(state, config = PLATFORM_COSTS_CONFIG) {
  const app = express();
  app.use(
    makeBillingRoutes({
      config,
      store: {
        load: () => state,
        platformTtsUsageView: (nowIso) => platformTtsUsageView(state, PLATFORM_COSTS_CONFIG.billing, nowIso),
      },
      audit: () => {},
      billing: {},
      tenant: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const fetchCosts = (app) => fetch(`${app.base}/api/billing/platform-costs`);

function number(id, e164, tenantId, status) {
  return { id, e164, tenantId, provider: "telnyx", status, providerNumberId: null };
}

const ACTIVE_COUNT = 3;
function mixedSeed() {
  return {
    ...seedState({
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas" },
        { id: "kunde-1", status: "active", ownerName: "Kunde Eins" },
        { id: PII_TENANT, status: "active", ownerName: "Kunde Zwei" },
      ],
      numbers: [
        number("num_owner", "+15005550006", BOOTSTRAP_TENANT_ID, NUMBER_STATUS.ACTIVE),
        number("num_k1", "+4930111", "kunde-1", NUMBER_STATUS.ACTIVE),
        number("num_k2", PII_PHONE, PII_TENANT, NUMBER_STATUS.ACTIVE),
        number("num_prov", "+4930222", "kunde-1", NUMBER_STATUS.PROVISIONING),
        number("num_rel", "+4930333", "kunde-1", NUMBER_STATUS.RELEASED),
      ],
    }),
    platformTtsUsage: emptyPlatformTtsUsage(),
  };
}

test("GET /api/billing/platform-costs: Form, Arithmetik und ACTIVE-Filter", async () => {
  const app = await startPlatformCostsApp(mixedSeed());
  try {
    const res = await fetchCosts(app);
    assert.equal(res.status, 200, "Endpunkt verdrahtet (kein 404 durch Pfad-Tippfehler)");
    const body = await res.json();

    assert.equal(body.currency, "EUR");
    assert.equal(body.listPriceNotBilled, true, "Listenpreis, NICHT Rechnungsposten (Entscheidung 6)");
    assert.equal(body.activeNumbers, ACTIVE_COUNT, "nur NUMBER_STATUS.ACTIVE zaehlt, inaktive fallen raus");
    assert.equal(body.elevenLabsUsdCents, PLATFORM_FIXED_COST_USD_CENTS, "USD-Listenpreis reist separat mit");
    assert.equal(body.elevenLabsCents, ELEVENLABS_EUR_CENTS, "ElevenLabs-Wand: USD-Listenpreis x EINER Kurs, aufgerundet");
    assert.equal(
      body.didRentCents,
      NUMBER_MONTHLY_COST_CENTS * ACTIVE_COUNT,
      "didRentCents = numberMonthlyCostCents * activeNumbers",
    );
    assert.equal(
      body.fixedCostCentsPerMonth,
      ELEVENLABS_EUR_CENTS + NUMBER_MONTHLY_COST_CENTS * ACTIVE_COUNT,
      "fixedCostCentsPerMonth = elevenLabsCents + didRentCents",
    );
    assert.ok(Number.isInteger(body.fixedCostCentsPerMonth), "Ganzzahl-Cent, kein Float");

    assert.equal(body.ttsQuota.characters, 0, "frischer Store: noch keine Zeichen verbucht");
    assert.equal(body.ttsQuota.quota, TTS_CHARACTER_QUOTA);
    assert.equal(body.ttsQuota.warnPercent, TTS_WARN_PERCENT);
    assert.equal(typeof body.ttsQuota.cycleKey, "string", "Zyklus-Schluessel ist gestempelt");
  } finally {
    await app.close();
  }
});

test("GET /api/billing/platform-costs: Antwort ist PII-frei (kein E.164, keine Tenant-Kennung)", async () => {
  const app = await startPlatformCostsApp(mixedSeed());
  try {
    const raw = JSON.stringify(await (await fetchCosts(app)).json());
    assert.ok(!raw.includes(PII_PHONE), "keine Rufnummer in der Antwort");
    assert.ok(!raw.includes(PII_TENANT), "keine Tenant-Kennung in der Antwort");
    assert.ok(!raw.includes(BOOTSTRAP_TENANT_ID), "auch die Bootstrap-Tenant-Kennung nicht");
  } finally {
    await app.close();
  }
});

test(
  "GET /api/billing/platform-costs extern ohne Admin-Sitzung -> 404 (Route ohne operatorAuth nicht gemountet)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      const res = await fetch(`${srv.externalUrl}/api/billing/platform-costs`);
      assert.equal(res.status, 404);
    } finally {
      await srv.stop();
    }
  },
);

const UEBERLAUF_USD_CENTS = 9800;
const HTTP_SERVER_ERROR = 500;
test("GET /api/billing/platform-costs: Kurs-Produkt ausserhalb des sicheren Ganzzahlbereichs -> 500 mit Diagnose, keine stille 0", async () => {
  const app = await startPlatformCostsApp(
    mixedSeed(),
    withConfigNamespaces({ ...PLATFORM_COSTS_CONFIG.billing, platformFixedCostUsdCentsPerMonth: UEBERLAUF_USD_CENTS }),
  );
  try {
    const res = await fetchCosts(app);
    assert.equal(res.status, HTTP_SERVER_ERROR, "nicht berechenbar wird gemeldet, nicht als 0 ausgegeben");
    const body = await res.json();
    assert.match(body.error, /nicht berechenbar/);
    assert.match(body.error, /PLATFORM_FIXED_COST_CENTS_PER_MONTH/, "die Meldung nennt die Ursachen-Env");
    assert.equal(body.fixedCostCentsPerMonth, undefined, "keine Summe, die den ElevenLabs-Anteil still verschwinden laesst");
  } finally {
    await app.close();
  }
});

test("countActiveNumbers: leerer Nummernbestand -> 0", () => {
  assert.equal(countActiveNumbers(makeDefaultState()), 0);
});

test("countActiveNumbers: alle aktiv -> volle Zahl", () => {
  const s = makeDefaultState();
  s.numbers = [
    number("a", "+491", BOOTSTRAP_TENANT_ID, NUMBER_STATUS.ACTIVE),
    number("b", "+492", "kunde-1", NUMBER_STATUS.ACTIVE),
  ];
  assert.equal(countActiveNumbers(s), 2);
});

test("countActiveNumbers: gemischt -> nur ACTIVE zaehlt", () => {
  const s = makeDefaultState();
  s.numbers = [
    number("a", "+491", BOOTSTRAP_TENANT_ID, NUMBER_STATUS.ACTIVE),
    number("b", "+492", "kunde-1", NUMBER_STATUS.PROVISIONING),
    number("c", "+493", "kunde-1", NUMBER_STATUS.RELEASED),
    number("d", "+494", "kunde-2", NUMBER_STATUS.ACTIVE),
  ];
  assert.equal(countActiveNumbers(s), 2);
});
