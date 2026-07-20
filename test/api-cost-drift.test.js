// LCT P5 (Review-Blocker Runde 1): HTTP-Test fuer GET /api/billing/cost-drift.
//
// WARUM DIESER TEST TRAEGT: dieser Endpunkt ist der Deliverable, der in P5 an die Stelle
// der urspruenglich geplanten Owner-Dashboard-Anzeige getreten ist (public/index.html
// existiert seit der Owner-Removal-Kette nicht mehr, s. PLAN-LIVE-COST-TRACING.md,
// P5 "Abweichung 2"). P4b haengt sein Abnahmekriterium an genau diese Sichtbarkeit:
// insufficient_samples MUSS samt Stichprobenzahl erscheinen, damit Schweigen nicht mit
// Zustimmung verwechselt wird. Ohne Test waere die einzige verbliebene Sichtbarkeit
// ungeprueft. Spawn-Test (startServer), netzfrei - der Endpunkt rechnet rein aus dem
// geladenen Store-Spiegel und kontaktiert keinen Provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp } from "./helpers.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, COST_TRUING_SOURCE } from "../src/store/defaults.js";
import { TARIFF_DRIFT_FINDING } from "../src/billing/cost-calibration.js";

const EXTERNAL_IP = externalIp();
const MS_PER_MINUTE = 60 * 1000;
// Praefixe aus VOICE_TARIFF_DOMESTIC_PREFIXES (src/config.js) - der Endpunkt bewertet
// genau diese drei, in dieser Reihenfolge.
const DOMESTIC_PREFIXES = ["+49", "+33", "+44"];
// PII-Fixturen: markant, damit ein Leak in der Antwort nicht in generischen Zahlen
// untergeht. Der Praefix "+49" selbst ist KEINE Rufnummer und darf erscheinen.
const PII_PHONE = "+4915155512345";
const PII_TENANT_NAME = "Klarname-Musterfirma-GmbH";

const fetchDrift = (srv) => fetch(`${srv.localUrl}/api/billing/cost-drift`);

function truedOutboundCall(state, { to, actualCostMicroCents, minutesAgo }) {
  const call = createCall(state, {
    direction: "outbound",
    from: PII_PHONE,
    to,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: PROVIDER.TWILIO,
  });
  call.status = "completed";
  call.answeredAt = new Date(Date.now() - (minutesAgo + 1) * MS_PER_MINUTE).toISOString();
  call.endedAt = new Date(Date.now() - minutesAgo * MS_PER_MINUTE).toISOString();
  call.costTruedAt = new Date().toISOString();
  call.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  call.actualCostMicroCents = actualCostMicroCents;
  return call;
}

// (A) DAS Akzeptanzkriterium: am leeren Store liefert jeder Praefix
// insufficient_samples MIT Stichprobenzahl - nicht "kein Befund", nicht ein stilles 200
// ohne Aussage. "Zu wenig Daten" und "im Band" sind hier unterscheidbar.
test("GET /api/billing/cost-drift, leerer Store: insufficient_samples je Praefix, samples sichtbar", async () => {
  const srv = await startServer();
  try {
    const res = await fetchDrift(srv);
    assert.equal(res.status, 200, "Endpunkt verdrahtet (kein 404 durch Pfad-Tippfehler)");
    const body = await res.json();
    assert.deepEqual(
      body.prefixes.map((e) => e.prefix),
      DOMESTIC_PREFIXES,
      "alle konfigurierten Praefixe werden bewertet",
    );
    for (const entry of body.prefixes) {
      assert.equal(entry.code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
      assert.equal(entry.samples, 0, "Stichprobenzahl ist sichtbar, nicht weggelassen");
      assert.equal(entry.measuredCentsPerMin, null, "keine Tarif-Aussage ohne Datenlage");
    }
  } finally {
    await srv.stop();
  }
});

// (B) Unterhalb COST_CALIBRATION_MIN_SAMPLES (20, in BASE_ENV gepinnt) bleibt es bei
// insufficient_samples - aber die Stichprobenzahl waechst sichtbar mit. Genau das
// unterscheidet "noch keine Aussage moeglich" von "der Job laeuft nicht".
test("GET /api/billing/cost-drift unter der Mindeststichprobe: insufficient_samples, aber samples zaehlt mit", async () => {
  const seed = makeDefaultState();
  const SAMPLE_COUNT = 3;
  for (let i = 0; i < SAMPLE_COUNT; i++)
    truedOutboundCall(seed, {
      to: `${DOMESTIC_PREFIXES[0]}15155512345`,
      actualCostMicroCents: 8636870,
      minutesAgo: 10 + i,
    });

  const srv = await startServer({ seed });
  try {
    const res = await fetchDrift(srv);
    const body = await res.json();
    const de = body.prefixes.find((e) => e.prefix === DOMESTIC_PREFIXES[0]);
    assert.equal(de.code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
    assert.equal(de.samples, SAMPLE_COUNT, "gezaehlte Stichproben sind sichtbar");
    assert.equal(de.measuredCentsPerMin, null);
  } finally {
    await srv.stop();
  }
});

// (C) PII-Riegel: die Antwort traegt Praefix, Befund, Stichprobenzahl und zwei
// Cent-Betraege - KEINE Rufnummer, KEINE Call-ID, KEINEN Tenant-Klarnamen. Der Endpunkt
// liest den vollen Cross-Tenant-Spiegel; ein durchgereichtes Feld faellt hier auf.
test("GET /api/billing/cost-drift: Antwort ist PII-frei", async () => {
  const seed = makeDefaultState();
  seed.settings[BOOTSTRAP_TENANT_ID].agentName = PII_TENANT_NAME;
  const call = truedOutboundCall(seed, {
    to: `${DOMESTIC_PREFIXES[0]}15155512345`,
    actualCostMicroCents: 8636870,
    minutesAgo: 10,
  });

  const srv = await startServer({ seed });
  try {
    const res = await fetchDrift(srv);
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes(PII_PHONE), "keine Rufnummer in der Antwort");
    assert.ok(!raw.includes(call.id), "keine Call-ID in der Antwort");
    assert.ok(!raw.includes(PII_TENANT_NAME), "kein Tenant-Klarname in der Antwort");
    assert.ok(!raw.includes(BOOTSTRAP_TENANT_ID), "keine Tenant-Kennung in der Antwort");
    assert.ok(raw.includes(DOMESTIC_PREFIXES[0]), "der Praefix selbst ist keine PII und bleibt");
  } finally {
    await srv.stop();
  }
});

// (D) Auth fail-closed (CLAUDE.md Regel 3): der Endpunkt liegt hinter der bestehenden
// /api/*-Basic-Auth. Er traegt eine Plattform-Aggregation ueber ALLE Tenants - genau die
// Groesse, die nicht ungegatet erreichbar sein darf. Extern ohne Credentials -> 401.
test(
  "GET /api/billing/cost-drift extern ohne Creds -> 401 (Basic-Auth fail-closed)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      const res = await fetch(`${srv.externalUrl}/api/billing/cost-drift`);
      assert.equal(res.status, 401);
    } finally {
      await srv.stop();
    }
  },
);
