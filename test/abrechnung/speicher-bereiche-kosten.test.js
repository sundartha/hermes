import assert from "node:assert/strict";
import { test } from "node:test";

import { PROVIDER } from "../../src/begriffe/nummern-vergabe.js";
import { speicherBereiche } from "../../src/store.js";

function marker(code, felder = {}) {
  return {
    id: `otg_${code}`, code, firstSeenAt: "2026-11-14T08:00:00.000Z", lastSeenAt: "2026-11-14T08:00:00.000Z",
    lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null, ...felder,
  };
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
