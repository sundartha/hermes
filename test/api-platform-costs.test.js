// LCT P7 (Fixkosten sichtbar machen): Tests fuer GET /api/billing/platform-costs und den
// dahinterliegenden Plattform-Zaehler countActiveNumbers (src/store/views.js).
//
// WARUM DIESER TEST TRAEGT: die Route ist DER Phasen-Deliverable - sie macht die zwei
// Fixkosten-Achsen (ElevenLabs-Wand + DID-Listenmiete) ueberhaupt erst sichtbar
// (public/index.html existiert seit der Owner-Removal-Kette nicht mehr, s.
// PLAN-LIVE-COST-TRACING.md). Ungeprueft blieben sonst: die Response-Form, die ZWEI
// Cent-Rechnungen (didRentCents = numberMonthlyCostCents * activeNumbers und
// fixedCostCentsPerMonth = platformFixedCostCentsPerMonth + didRentCents), die Filterung
// auf NUMBER_STATUS.ACTIVE und die Auth-fail-closed-Zusage.
//
// AUTH-P6: platform-costs ist seither eine Betreiber-Route (webAuthMw+adminMw, nur MIT
// operatorAuth gemountet). (A)-(B) migriert auf In-Process-Mount von makeBillingRoutes
// (Muster api-cost-drift.test.js) - die Route rechnet rein aus dem geladenen Store-
// Spiegel und der Config, kontaktiert keinen Provider. platformTtsUsage wird HIER
// explizit ergaenzt (emptyPlatformTtsUsage): seedState() traegt es nicht, der json-
// Store-Reader backfillt es sonst beim Laden nach (src/store/json.js). (C) misst, dass
// ohne Admin-Sitzungs-Infra (json-Spawn, kein SESSION_SECRET) die Route gar nicht
// gemountet ist (404) - seit AUTH-P7 kein Gate mehr, das antworten koennte. Bleibt
// darum ein echter Spawn-Test, UNVERAENDERT.
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

// In BASE_ENV (test/helpers.js) gepinnte Fixkosten-Achse - hier als Config-Double
// gespiegelt, damit die Arithmetik-Assertion nicht raet, sondern gegen die gepinnte
// Basis rechnet.
const NUMBER_MONTHLY_COST_CENTS = 92;
const PLATFORM_FIXED_COST_CENTS = 600;
const TTS_CHARACTER_QUOTA = 39981;
const TTS_WARN_PERCENT = 0; // BASE_ENV pinnt die Warnschwelle neutral AUS

const PLATFORM_COSTS_CONFIG = withConfigNamespaces({
  numberMonthlyCostCents: NUMBER_MONTHLY_COST_CENTS,
  platformFixedCostCentsPerMonth: PLATFORM_FIXED_COST_CENTS,
  ttsCharacterQuota: TTS_CHARACTER_QUOTA,
  ttsCharacterQuotaWarnPercent: TTS_WARN_PERCENT,
  ttsQuotaCycleAnchorDay: 1,
});

// PII-Fixturen: markant, damit ein Leak in der Antwort nicht in generischen Zahlen
// untergeht. Die Antwort traegt einen Nummern-ZAEHLER, KEINE E.164, keine Tenant-Kennung.
const PII_PHONE = "+4915155599999";
const PII_TENANT = "kunde-pii-klarname";

async function startPlatformCostsApp(state) {
  const app = express();
  app.use(
    makeBillingRoutes({
      config: PLATFORM_COSTS_CONFIG,
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

// Drei AKTIVE Nummern (Bootstrap + zwei Kunden) plus zwei INAKTIVE (provisioning +
// released).
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

// (A) Response-Form + die zwei Cent-Rechnungen + die Filterung auf ACTIVE. Der Endpunkt
// zaehlt genau die drei aktiven Nummern (die zwei inaktiven fallen raus) und rechnet
// beide Fixkosten-Summen daraus - Ganzzahl-EUR-Cent.
test("GET /api/billing/platform-costs: Form, Arithmetik und ACTIVE-Filter", async () => {
  const app = await startPlatformCostsApp(mixedSeed());
  try {
    const res = await fetchCosts(app);
    assert.equal(res.status, 200, "Endpunkt verdrahtet (kein 404 durch Pfad-Tippfehler)");
    const body = await res.json();

    assert.equal(body.currency, "EUR");
    assert.equal(body.listPriceNotBilled, true, "Listenpreis, NICHT Rechnungsposten (Entscheidung 6)");
    assert.equal(body.activeNumbers, ACTIVE_COUNT, "nur NUMBER_STATUS.ACTIVE zaehlt, inaktive fallen raus");
    assert.equal(body.elevenLabsCents, PLATFORM_FIXED_COST_CENTS);
    assert.equal(
      body.didRentCents,
      NUMBER_MONTHLY_COST_CENTS * ACTIVE_COUNT,
      "didRentCents = numberMonthlyCostCents * activeNumbers",
    );
    assert.equal(
      body.fixedCostCentsPerMonth,
      PLATFORM_FIXED_COST_CENTS + NUMBER_MONTHLY_COST_CENTS * ACTIVE_COUNT,
      "fixedCostCentsPerMonth = platformFixedCostCentsPerMonth + didRentCents",
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

// (B) PII-Riegel: die Antwort traegt nur Cent-Betraege, einen Nummern-ZAEHLER und die
// TTS-Kontingent-Zahlen - KEINE E.164, KEINE Tenant-Kennung. Der Endpunkt liest den vollen
// Cross-Tenant-Spiegel; ein durchgereichtes Feld faellt hier auf.
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

// (C) Auth fail-closed (CLAUDE.md Regel 3): die Route ist eine Betreiber-Route und
// existiert ohne Admin-Sitzungs-Infra (json-Spawn, kein SESSION_SECRET) gar nicht -
// niemals ungeschuetzt. Sie traegt eine Plattform-Aggregation ueber ALLE Tenants -
// genau die Groesse, die nicht ungegatet erreichbar sein darf. Extern ohne
// Credentials -> 404. UNVERAENDERT (echter Spawn-Server): misst die Mount-Bedingung,
// nicht die Route-Logik.
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

// ---- countActiveNumbers (src/store/views.js) direkt ----
// Der reine Zaehler hinter der Route. Grenzfaelle: leer, alles aktiv, gemischt - genau die
// Filterung, auf die sich die DID-Miete-Rechnung verlaesst.
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
