// KS-P8 (E4): die Tenant-Projektion (/api/state.usage) zeigt Prozent, nie Euro. Harness-
// Muster 1:1 aus test/api-state-usage-axis.test.js (makeReadRoutes isoliert montiert,
// Mock-Store, Fake-Config, Fake-Tenant-Resolver - kein Server-Spawn, kein Netz, F.I.R.S.T.).
//
// Die reale Minuten-Ableitung (quotaView/planMinutesExceeded/voiceMinutesUsedSince) laeuft
// gegen ein echtes usageEvents-Ledger (makeDefaultState + recordUsageEvent, Muster
// test/bk4-quota-view.test.js) - store.load() liefert diesen Zustand, store.tenantSubscription
// wird separat gemockt (Abo-Referenzen leben am Tenant-Objekt, nicht am Ledger).
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeReadRoutes } from "../src/routes/api-read.js";
import { recordUsageEvent, makeDefaultState } from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

// Fixes Fenster (zeit-frei, Muster bk4-quota-view.test.js): Periodenende faellt auf
// 2026-07-15T00:00Z, Periodenstart wird daraus abgeleitet (2026-06-15T00:00Z).
const MS_PER_SECOND = 1000;
const PERIOD_END_SEC = Date.UTC(2026, 6, 15) / MS_PER_SECOND;
const IN_WINDOW = "2026-06-20T10:00:00.000Z";

// Waehrungs-/Geldfeld-Detektor: prueft KEYS (unsere Struktur), nicht Werte (Transkripte
// duerfen "EUR" enthalten, ohne dass die Projektion Geld anzeigt). Rekursiver Key-Walk
// ueber die GESAMTE Antwort - so faengt K2 auch ein wiedereingefuehrtes Geldfeld an
// beliebiger Stelle, nicht nur in usage.
// "cents" MUSS das s tragen (mandatory, kein "?") - sonst matcht das anchor-Ende
// "...Percent" faelschlich ueber die zufaellige Teilzeichenkette "cent" (false positive
// auf unser eigenes neues Feld planUsagePercent).
const MONEY_KEY = /eur|cents$|price|amount|budget|cap$/i;
function moneyKeysIn(value, path = "$") {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const here = MONEY_KEY.test(k) ? [`${path}.${k}`] : [];
      return [...here, ...moneyKeysIn(v, `${path}.${k}`)];
    });
  }
  return [];
}

// Seedet ein Voice-Minuten-Kontingent im echten Ledger. periodStartSec dient nur der
// Doku-Absicht des Aufrufers (das Fenster wird ueber PERIOD_END_SEC/currentPeriodEnd
// gesetzt, s. resolvePeriodStartIso-Praezedenz) - kein zweiter Fenster-Mechanismus.
function seedQuotaState({ usedMinutes = 0 } = {}) {
  const s = makeDefaultState();
  if (usedMinutes > 0) {
    const e = recordUsageEvent(s, {
      tenantId: BOOTSTRAP_TENANT_ID,
      kind: USAGE_EVENT_KIND.VOICE_MINUTE,
      quantity: usedMinutes,
      costCents: 0,
    });
    e.occurredAt = IN_WINDOW;
  }
  return s;
}

// store: load() liefert den echten Ledger-State + die Bestandslisten fuer /api/state.
// tenantSubscription() ist unabhaengig gemockt (Abo-Referenzen leben am Tenant, nicht am
// Ledger) - subscription ist per Test ueberschreibbar (planSlug/currentPeriodEnd).
function makeMockStore({ state, subscription = {} } = {}) {
  return {
    load: () => ({ ...state, calls: [], actionItems: [], notifications: [], numbers: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    // E4: /api/state scoped unbedingt ueber exportTenantData.
    exportTenantData: () => ({ calls: [], actionItems: [], notifications: [] }),
    usageOf: () => ({ inputTokens: 5, outputTokens: 7, calls: 3 }),
    tenantSubscription: () => ({
      planSlug: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      periodCreditRevoked: false,
      ...subscription,
    }),
    getCalendar: () => [],
  };
}

function makeConfig() {
  return withConfigNamespaces({
    multiTenant: false,
    claudeModel: "claude-haiku-4-5",
    voiceEngine: "budget",
  });
}

function makeTenant() {
  return {
    requestTenant: () => BOOTSTRAP_TENANT_ID,
    requireTenant: () => BOOTSTRAP_TENANT_ID,
    tenantOwnsCall: () => true,
  };
}

async function mount(store) {
  const app = express();
  app.use(express.json());
  app.use(makeReadRoutes({ store, config: makeConfig(), audit: () => {}, tenant: makeTenant() }));
  const server = await new Promise((res) => {
    const s = app.listen(0, () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => new Promise((r) => server.close(r)) };
}

// K1: die Whitelist beweist, dass genau die vier erwarteten Felder da sind - kein
// Geldfeld schleicht sich unter neuem Namen wieder ein.
test("K1: usage-Whitelist traegt genau calls/inputTokens/outputTokens/planUsagePercent", async () => {
  const store = makeMockStore({ state: seedQuotaState() });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.deepEqual(
      Object.keys(body.usage).sort(),
      ["calls", "inputTokens", "outputTokens", "planUsagePercent"],
    );
  } finally {
    await srv.stop();
  }
});

// K2 (Spec-Pflicht-Grep): kein Geldfeld irgendwo in der GESAMTEN /api/state-Antwort.
test("K2: kein Waehrungs-/Geldfeld in der gesamten /api/state-Antwort", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 12 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.deepEqual(moneyKeysIn(body), []);
  } finally {
    await srv.stop();
  }
});

// K3: Starter (30 min), 12 min verbraucht -> 40 %.
test("K3: Starter 30 min, 12 verbraucht -> 40 Prozent", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 12 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 40);
  } finally {
    await srv.stop();
  }
});

// K4 (D1, Mutationsprobe): kein Plan hinterlegt -> null, NIEMALS 0.
test("K4: kein Plan hinterlegt -> planUsagePercent null (nie 0)", async () => {
  const store = makeMockStore({ state: seedQuotaState() }); // subscription-Default: planSlug null
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, null);
  } finally {
    await srv.stop();
  }
});

// K5: voll erschoepft (30 von 30) -> genau 100.
test("K5: erschoepft (30 von 30 Minuten) -> 100 Prozent", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 30 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 100);
  } finally {
    await srv.stop();
  }
});

// K6 (D3, Mutationsprobe): 29 von 30 -> floor(96.67) = 96, NIE 100 (das Gate laesst noch
// durch - eine gerundete 100 waere eine Luege in der einzigen Zahl, die der Kunde hat).
test("K6: 29 von 30 Minuten -> 96 Prozent (floor, nie 100)", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 29 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 96);
  } finally {
    await srv.stop();
  }
});

// K7: kein Perioden-Anker (frisches Abo, Webhook ausstehend) -> das Outbound-Gate blockt
// bereits (fail-closed) -> die Anzeige muss dasselbe zeigen: 100 %.
test("K7: kein Perioden-Anker -> 100 Prozent (fail-closed, == Gate)", async () => {
  const store = makeMockStore({
    state: seedQuotaState(),
    subscription: { planSlug: "starter", currentPeriodEnd: null },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 100);
  } finally {
    await srv.stop();
  }
});

// K8: reine Leseprojektion - zwei Polls duerfen das Ledger nicht veraendern, kein save().
test("K8: reine Leseprojektion - usageEvents byte-identisch, kein save()", async () => {
  const state = seedQuotaState({ usedMinutes: 12 });
  const before = JSON.stringify(state.usageEvents);
  let saveCalls = 0;
  const store = {
    ...makeMockStore({
      state,
      subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
    }),
    save: () => {
      saveCalls++;
    },
  };
  const srv = await mount(store);
  try {
    await fetch(`${srv.base}/api/state`);
    await fetch(`${srv.base}/api/state`); // zweiter Poll: ein Schreibeffekt waere hier sichtbar
    assert.equal(JSON.stringify(state.usageEvents), before);
    assert.equal(saveCalls, 0);
  } finally {
    await srv.stop();
  }
});
