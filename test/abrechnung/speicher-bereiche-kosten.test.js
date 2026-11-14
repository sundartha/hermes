import assert from "node:assert/strict";
import { test } from "node:test";

import { COST_TRUING_SOURCE } from "../../src/begriffe/abrechnung.js";
import { PROVIDER } from "../../src/begriffe/nummern-vergabe.js";
import { backfillPlanProfiles } from "../../src/billing/backfill-profiles.ts";
import { makeCostTruing } from "../../src/billing/cost-truing.ts";
import { makeDefaultState } from "../../src/store/state-ops.js";
import { speicherBereiche } from "../../src/store.js";
import { fakeConfig, fakeVoiceControl, makeDueOutboundCall, makeStubStore } from "../cost-truing-harness.js";

const JETZT_MS = Date.parse("2026-11-14T12:00:00.000Z");

function marker(code, felder = {}) {
  return {
    id: `otg_${code}`, code, firstSeenAt: "2026-11-14T08:00:00.000Z", lastSeenAt: "2026-11-14T08:00:00.000Z",
    lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null, ...felder,
  };
}

function ruhig(arbeit) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  return arbeit().finally(() => {
    console.log = log;
    console.warn = warn;
  });
}

test("ausfall: offenerMarker liefert den offenen Marker zum Code, sonst nichts, und liest load erst beim Aufruf", async () => {
  const zustand = {
    outageAlerts: [marker("a", { closedAt: "2026-11-14T09:00:00.000Z" }), marker("a", { id: "offen" }), marker("b")],
  };
  const speicher = {};
  const { ausfall } = speicherBereiche(speicher);
  speicher.load = () => zustand;
  const antwort = ausfall.offenerMarker({ code: "a" });
  assert.ok(antwort instanceof Promise);
  assert.equal((await antwort).id, "offen");
  assert.equal(await ausfall.offenerMarker({ code: "c" }), undefined);
  zustand.outageAlerts = [marker("a", { closedAt: "2026-11-14T09:00:00.000Z" })];
  assert.equal(await ausfall.offenerMarker({ code: "a" }), undefined);
});

test("kostenbelege: abgleichZustand liefert genau Anrufe und Belege als dieselben Listen wie der Speicher", async () => {
  const zustand = { calls: [{ id: "c1" }], callCostEvidence: [{ callId: "c1" }], tenants: [{ id: "t" }] };
  const speicher = {};
  const { kostenbelege } = speicherBereiche(speicher);
  speicher.load = () => zustand;
  const antwort = kostenbelege.abgleichZustand();
  assert.ok(antwort instanceof Promise);
  const ergebnis = await antwort;
  assert.deepEqual(Object.keys(ergebnis).sort(), ["callCostEvidence", "calls"]);
  assert.equal(ergebnis.calls, zustand.calls);
  assert.equal(ergebnis.callCostEvidence, zustand.callCostEvidence);
});

test("kostenbelege: querpruefungMonat nennt den Vormonat, solange er nicht geprueft ist", async () => {
  const zustand = { costCrossCheck: { lastCheckedMonthKey: null } };
  const speicher = { load: () => zustand };
  const { kostenbelege } = speicherBereiche(speicher);
  assert.equal(await kostenbelege.querpruefungMonat("2026-08-15T12:00:00.000Z"), "2026-07");
  zustand.costCrossCheck.lastCheckedMonthKey = "2026-06";
  assert.equal(await kostenbelege.querpruefungMonat("2026-08-15T12:00:00.000Z"), "2026-07");
  zustand.costCrossCheck.lastCheckedMonthKey = "2026-07";
  assert.equal(await kostenbelege.querpruefungMonat("2026-08-15T12:00:00.000Z"), null);
});

test("kostenbelege: querpruefungSummen rechnet Traeger, Ist und Gate-Kosten des Monats aus dem Zustand beim Aufruf", async () => {
  const zustand = {
    calls: [
      { provider: PROVIDER.TELNYX, costTruedAt: "2026-07-20T00:00:00.000Z", actualCostMicroCents: 600, estimatedCostSpendMonthKey: "2026-07" },
      { provider: PROVIDER.TELNYX, costTruedAt: "2026-07-20T00:00:00.000Z", actualCostMicroCents: 90, estimatedCostSpendMonthKey: "2026-06" },
    ],
    usageEvents: [
      { kind: "voice_minute", occurredAt: "2026-07-03T10:00:00.000Z", costCents: 7 },
      { kind: "voice_minute", occurredAt: "2026-06-03T10:00:00.000Z", costCents: 100 },
    ],
  };
  const speicher = { load: () => zustand };
  const gefragt = [];
  const antwort = speicherBereiche(speicher).kostenbelege.querpruefungSummen({
    monthKey: "2026-07",
    belegSummeJeTraeger: (eingabe) => {
      gefragt.push(eingabe);
      return [{ traeger: "telnyx", mikroCents: 5 }];
    },
  });
  assert.ok(antwort instanceof Promise);
  assert.deepEqual(await antwort, {
    traegerSummen: [{ traeger: "telnyx", mikroCents: 5 }],
    istGesamtMicroCents: 600,
    gateCarrierEurCents: 7,
  });
  assert.equal(gefragt.length, 1);
  assert.equal(gefragt[0].state, zustand);
  assert.equal(gefragt[0].monthKey, "2026-07");
});

test("abgleich: mandantenMitProfilen liefert Mandanten und Profile als dieselben Objekte wie der Speicher", async () => {
  const zustand = { tenants: [{ id: "t1" }], profiles: { t1: { tier: "x" } }, calls: [] };
  const speicher = {};
  const { abgleich } = speicherBereiche(speicher);
  speicher.load = () => zustand;
  const antwort = abgleich.mandantenMitProfilen();
  assert.ok(antwort instanceof Promise);
  const ergebnis = await antwort;
  assert.deepEqual(Object.keys(ergebnis).sort(), ["profiles", "tenants"]);
  assert.equal(ergebnis.tenants, zustand.tenants);
  assert.equal(ergebnis.profiles, zustand.profiles);
});

test("backfill: ohne Abonnenten uebergeht der Lauf jeden Mandanten aus dem Bestand des Speichers und schreibt nichts", async () => {
  const zustand = { tenants: [{ id: "t1" }, { id: "t2" }], profiles: {} };
  const gefragt = [];
  const store = {
    load: () => zustand,
    tenantActiveSubscriber: (id) => {
      gefragt.push(id);
      return false;
    },
  };
  const bericht = await backfillPlanProfiles({ store, apply: true });
  assert.equal(bericht.scanned, 2);
  assert.deepEqual(gefragt, ["t1", "t2"]);
  assert.deepEqual(bericht.skipped.map(({ id }) => id), ["t1", "t2"]);
});

async function laufMitErholung({ vorLauf2 }) {
  const state = makeDefaultState();
  const calls = Array.from({ length: 5 }, (_, i) => makeDueOutboundCall(state, { nowMs: JETZT_MS, estimatedCostCents: 20, legRef: { callControlId: `cc_${i}` } }));
  for (const call of calls) call.costTruedAt = new Date(JETZT_MS).toISOString();
  calls[0].costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  for (const call of calls.slice(1)) call.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  const audit = [];
  let jetzt = JETZT_MS;
  const config = fakeConfig({ costTruingMinCoveragePercent: 80, costTruingCoverageStallSweeps: 100 });
  const { runCostTruingSweep } = makeCostTruing({
    store: makeStubStore(state), config, voiceControl: fakeVoiceControl({}),
    audit: (event, req, detail) => audit.push({ event, detail }), now: () => jetzt,
  });
  await ruhig(() => runCostTruingSweep({ trigger: "manual" }));
  jetzt = JETZT_MS + 3_600_000;
  vorLauf2({ state, calls });
  await ruhig(() => runCostTruingSweep({ trigger: "manual" }));
  return { state, audit };
}

test("cost-truing: erholte Deckung schliesst nur die Deckungs-Marker, fremde offene Marker bleiben offen", async () => {
  const { state, audit } = await laufMitErholung({
    vorLauf2: ({ state: zustand, calls }) => {
      zustand.outageAlerts.push(marker("kosten:anderer_befund"), marker("price-drift:lauf"));
      for (const call of calls.slice(1)) call.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
    },
  });
  const offen = state.outageAlerts.filter((alert) => alert.closedAt === null).map((alert) => alert.code);
  assert.ok(offen.includes("kosten:anderer_befund"));
  assert.ok(offen.includes("price-drift:lauf"));
  assert.ok(!offen.includes("kosten:coverage_below_threshold"));
  assert.deepEqual(audit.filter((eintrag) => eintrag.event === "cost_truing_erholt").map((eintrag) => eintrag.detail), ["marker=1"]);
});

test("cost-truing: bleibt die Deckung unten, nennt der zweite Befund den Beginn des offenen Markers", async () => {
  const { state, audit } = await laufMitErholung({ vorLauf2: () => {} });
  const erster = state.outageAlerts.find((alert) => alert.code === "kosten:coverage_below_threshold");
  assert.equal(erster.firstSeenAt, new Date(JETZT_MS).toISOString());
  const befunde = audit.filter(
    (eintrag) => eintrag.detail.startsWith("grund=coverage_below_threshold"),
  );
  assert.equal(befunde.length, 2);
  assert.match(befunde[1].detail, new RegExp(`seit=${erster.firstSeenAt}`));
});
