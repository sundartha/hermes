import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  makeDefaultState,
  claimPlatformSpendWarning,
} from "../src/store/state-ops.js";
import { emptyUsage } from "../src/store/defaults.js";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { tempDataDir } from "./helpers.js";

const TENANT_A = "tenant_a";
const CFG = { platformSpendCapCents: 1000, platformSpendWarnPercent: 80 };
const JULY_ISO = "2026-07-15T10:00:00.000Z";
const AUGUST_ISO = "2026-08-01T00:00:00.000Z";

function buildState(costCents) {
  const s = makeDefaultState();
  s.usage[TENANT_A] = { ...emptyUsage(), costCents };
  return s;
}

test("T1 rot-vor-Fix (a): zwei aufeinanderfolgende Ueberschreitungen im selben Monat -> genau EIN Ereignis", () => {
  const s = buildState(900);
  const first = claimPlatformSpendWarning(s, CFG, JULY_ISO);
  assert.deepEqual(first, { totalCents: 900, monthKey: "2026-07" });
  const second = claimPlatformSpendWarning(s, CFG, JULY_ISO);
  assert.equal(second, null, "zweiter Aufruf im selben Monat ist ein No-op");
});

test("T2 rot-vor-Fix (b): Verbrauch knapp UNTER der Schwelle -> keine Meldung", () => {
  const s = buildState(799);
  assert.equal(claimPlatformSpendWarning(s, CFG, JULY_ISO), null);
});

test("T2b Grenzwert exakt an der Schwelle (>=, G3-Grenzfall) -> feuert", () => {
  const s = buildState(800);
  assert.deepEqual(claimPlatformSpendWarning(s, CFG, JULY_ISO), {
    totalCents: 800,
    monthKey: "2026-07",
  });
});

test("T3 rot-vor-Fix (c): Monatswechsel -> genau EIN weiteres Ereignis mit neuem Monatsschluessel", () => {
  const s = buildState(900);
  assert.ok(claimPlatformSpendWarning(s, CFG, JULY_ISO), "Juli meldet");
  const second = claimPlatformSpendWarning(s, CFG, AUGUST_ISO);
  assert.deepEqual(second, { totalCents: 900, monthKey: "2026-08" });
});

test("T4 rot-vor-Fix (e): PLATFORM_SPEND_WARN_PERCENT=0 -> Warnung AUS, byte-identisch zum Bestand", () => {
  const s = buildState(999_999);
  const cfgOff = { platformSpendCapCents: 1000, platformSpendWarnPercent: 0 };
  assert.equal(claimPlatformSpendWarning(s, cfgOff, JULY_ISO), null);
  assert.equal(s.platformSpendWarnedMonth, null, "Marker bleibt unangetastet");
});

test("T5 In-Flight-Reserven zaehlen mit (die Warnung sieht denselben Ist-Stand wie das Reserve-Gate)", () => {
  const settledOnly = buildState(700);
  assert.equal(claimPlatformSpendWarning(settledOnly, CFG, JULY_ISO), null);

  const withReserve = buildState(700);
  withReserve.reservations[TENANT_A] = 200;
  assert.deepEqual(claimPlatformSpendWarning(withReserve, CFG, JULY_ISO), {
    totalCents: 900,
    monthKey: "2026-07",
  });
});

test("T6 unlesbares nowIso zweimal -> ZWEI Ereignisse, Marker bleibt unangetastet (nie stumm)", () => {
  const s = buildState(900);
  const first = claimPlatformSpendWarning(s, CFG, "kaputt");
  assert.deepEqual(first, { totalCents: 900, monthKey: null });
  const second = claimPlatformSpendWarning(s, CFG, "kaputt");
  assert.deepEqual(second, { totalCents: 900, monthKey: null }, "kein gespeicherter Marker -> wieder laut");
  assert.equal(s.platformSpendWarnedMonth, null);
});

test("T7 Ephemeralitaet (json): platformSpendWarnedMonth erscheint NIE in data/store.json", async () => {
  const dataDir = tempDataDir();
  const file = path.join(dataDir, "store.json");
  const { config } = await import("../src/config.js");
  config.server.dataDir = dataDir;
  const jsonStore = await import(`../src/store/json.js?platform-warn=${Date.now()}`);

  const s = jsonStore.load();
  s.usage[TENANT_A] = { ...emptyUsage(), costCents: 900 };

  const claimed = jsonStore.claimPlatformSpendWarning(CFG, JULY_ISO);
  assert.deepEqual(claimed, { totalCents: 900, monthKey: "2026-07" });

  jsonStore.save();
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(
    "platformSpendWarnedMonth" in onDisk,
    false,
    "platformSpendWarnedMonth ist strukturell von der Platte ausgeschlossen",
  );

  assert.equal(jsonStore.claimPlatformSpendWarning(CFG, JULY_ISO), null);
});

const VALID_TO = "+491711234567";
const TENANT = "T";
const DEFAULT_WARNING = { totalCents: 1005, monthKey: "2026-07" };

function baseCtx(overrides = {}) {
  return {
    to: VALID_TO,
    tenantId: TENANT,
    requestedBy: "owner",
    reserveCents: 60,
    fromNumber: "+491700000000",
    outboundProvider: "telnyx",
    ...overrides,
  };
}

function makeGateDeps(o = {}) {
  return {
    store: {
      withStoreLock: (fn) => fn(),
      tryReserveOutboundBudget: () => true,
      reserveExceedsBudget: () => false,
      tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 0, remainingCents: 1000 }),
      claimPlatformSpendWarning: () => DEFAULT_WARNING,
      ...o.store,
    },
    config: withConfigNamespaces({ platformAlertSmsTo: "", ...o.config }),
    requestTenant: () => TENANT,
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    audit: o.audit ?? (() => {}),
    messaging: o.messaging ?? (() => ({ sendSms: () => Promise.resolve() })),
  };
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);

test("T8 rot-vor-Fix (d): Warnung feuert -> audit genau 1x, Detail traegt NUR Summe+Monat", async () => {
  const auditCalls = [];
  const deps = makeGateDeps({
    audit: (event, req, detail) => auditCalls.push({ event, req, detail }),
  });
  const { gates } = makeOutboundGates(deps);
  await gateBy(gates, "reserve_budget").run(baseCtx());

  assert.equal(auditCalls.length, 1);
  assert.deepEqual(auditCalls[0], {
    event: "platform_spend_warning",
    req: null,
    detail: "summe_cents=1005 monat=2026-07",
  });
  assert.ok(!auditCalls[0].detail.includes("tenant"), "keine tenantId im Audit-Detail");
  assert.ok(!auditCalls[0].detail.includes("to="), "kein Ziel im Audit-Detail");
  assert.ok(!auditCalls[0].detail.includes(TENANT), "kein Tenant-Token im Audit-Detail");
});

test("T9: der Call bleibt erlaubt (null), obwohl die Warnung feuert", async () => {
  const { gates } = makeOutboundGates(makeGateDeps());
  const result = await gateBy(gates, "reserve_budget").run(baseCtx());
  assert.equal(result, null);
});

test("T10: fehlschlagende SMS (asynchroner reject) beeintraechtigt den Anruf NICHT, Fehler wird geloggt", async () => {
  const logs = [];
  const origError = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    const deps = makeGateDeps({
      config: { platformAlertSmsTo: "+491234567890" },
      messaging: () => ({ sendSms: () => Promise.reject(new Error("boom-async")) }),
    });
    const { gates } = makeOutboundGates(deps);
    const result = await gateBy(gates, "reserve_budget").run(baseCtx());
    assert.equal(result, null, "der Anruf laeuft normal weiter");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(logs.some((l) => l.includes("boom-async")), "der SMS-Fehler wurde geloggt");
  } finally {
    console.error = origError;
  }
});

test("T11: synchron werfendes messaging() beeintraechtigt den Anruf NICHT", async () => {
  const deps = makeGateDeps({
    config: { platformAlertSmsTo: "+491234567890" },
    messaging: () => {
      throw new Error("boom-sync");
    },
  });
  const { gates } = makeOutboundGates(deps);
  const result = await gateBy(gates, "reserve_budget").run(baseCtx());
  assert.equal(result, null);
});

test("T12: werfendes claimPlatformSpendWarning -> KEIN 402, KEINE haengende Reserve", async () => {
  const deps = makeGateDeps({
    store: {
      claimPlatformSpendWarning: () => {
        throw new Error("boom-claim");
      },
    },
  });
  const { gates } = makeOutboundGates(deps);
  const result = await gateBy(gates, "reserve_budget").run(baseCtx());
  assert.equal(result, null, "der Anruf laeuft normal weiter, keine Ablehnung");
});

test("T13: PLATFORM_ALERT_SMS_TO leer -> nur Audit, messaging() wird NIE aufgerufen", async () => {
  const auditCalls = [];
  let messagingCalls = 0;
  const deps = makeGateDeps({
    audit: (event, req, detail) => auditCalls.push({ event, req, detail }),
    messaging: () => {
      messagingCalls++;
      return { sendSms: () => Promise.resolve() };
    },
    config: { platformAlertSmsTo: "" },
  });
  const { gates } = makeOutboundGates(deps);
  await gateBy(gates, "reserve_budget").run(baseCtx());
  assert.equal(auditCalls.length, 1);
  assert.equal(messagingCalls, 0);
});

test("T14: claimPlatformSpendWarning liefert null (keine Ueberschreitung) -> weder Audit noch SMS", async () => {
  const auditCalls = [];
  let messagingCalls = 0;
  const deps = makeGateDeps({
    store: { claimPlatformSpendWarning: () => null },
    audit: (event, req, detail) => auditCalls.push({ event, req, detail }),
    messaging: () => {
      messagingCalls++;
      return { sendSms: () => Promise.resolve() };
    },
    config: { platformAlertSmsTo: "+491234567890" },
  });
  const { gates } = makeOutboundGates(deps);
  const result = await gateBy(gates, "reserve_budget").run(baseCtx());
  assert.equal(result, null, "Gate-Verhalten bleibt byte-identisch");
  assert.equal(auditCalls.length, 0);
  assert.equal(messagingCalls, 0);
});
