// B2 (GAP B): Minuten-Kontingent-Gate vor Outbound. Spawn-/json-Integration + reine
// Unit. KEIN pglite in DIESER Datei (Lehre p6a: pglite + Server-Spawn NIE mischen) -
// die einzigen backend-beruehrenden Aufrufe des Gates (tenantSubscription,
// planMinutesExceeded) sind auf pglite bereits gruen (b1b-/store-pg-Tests); die
// HTTP-Verdrahtung liest ausschliesslich ueber die Store-Fassade und ist damit
// backend-identisch, resolvePeriodStartIso ist backend-frei (Unit unten deckt sie).
//
// Identitaet wie outbound-tenant.test.js: localhost-Request mit X-Internal-Identity =
// idpSubject -> exakt der requestTenant-REST-Pfad. Offline-Diskriminator: ein Request,
// der ALLE Gates passiert, scheitert erst am Offline-Originate (500); ein vom Gate
// geblockter Request liefert 402 (kein Originate, kein Call-Record).
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { findPlan } from "../src/plans.js";
import { resolvePeriodStartIso, periodStartFromEnd } from "../src/billing/period.js";

const TO = "+4915112345678"; // erlaubtes Ziel (ALLOWED_NUMBERS), kein Premium/Notruf

const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A = "+4915110000001";

// Inkludierte Minuten aus der EINEN Quelle (kein Magic 30): bricht ein Katalog-Edit den
// Test, statt ihn still falsch werden zu lassen.
const STARTER_MIN = findPlan("starter").includedMinutes;

const SECONDS_PER_DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);
const fiveDaysAgoSec = nowSec - 5 * SECONDS_PER_DAY; // Periodenanker im laufenden Fenster
const twentyFiveDaysAheadSec = nowSec + 25 * SECONDS_PER_DAY; // currentPeriodEnd (Bestands-Fallback)

const activeNumber = (id, e164, tenantId, status = "active") => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status,
  providerNumberId: null,
});

// voice_minute-Ledger-Eintrag im laufenden Fenster (occurredAt = jetzt liegt nach jedem
// Periodenanker der Tests). quantity = verbrauchte Minuten (Ganzzahl), kind aus der
// kuratierten Quelle (recordUsageEvent wuerfe sonst).
const voiceMinuteEvent = (tenantId, quantity, idSuffix = "") => ({
  id: `ue_${tenantId}${idSuffix}`,
  tenantId,
  callId: null,
  kind: USAGE_EVENT_KIND.VOICE_MINUTE,
  quantity,
  costCents: 0,
  occurredAt: new Date().toISOString(),
  stripeMeterSent: false,
});

const bucket = (costEur) => ({ inputTokens: 0, outputTokens: 0, costEur, calls: costEur ? 1 : 0 });

// A2/A3-provisioniertes Tier-Profil: maxCallsPerHour=null entkoppelt den aktiven
// Subscriber vom DEFAULT_PROFILE(0)-User-Hour-Gate (A4 go-live-Haertung). Minimaler
// Stub - nur das fuer dieses Minuten-Gate relevante Feld (planProfileFor traegt es real).
const PROVISIONED_PROFILE = { maxCallsPerHour: null };

// Aktiver, KYC-verifizierter (card) Subscriber A mit eigener aktiver Nummer + Abo-Anker.
// Die uebrigen Outbound-Gates (KYC, Allowlist via tenantActiveSubscriber, Nummer, Budget)
// muessen passieren, damit der Test GENAU das Minuten-Gate isoliert. usageEvents (Minuten-
// Achse) und usage (EUR-Achse) sind unabhaengig seedbar.
function seedQuota({ subscription = {}, usageEvents = [], usage } = {}) {
  const s = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: A,
        status: "active",
        idpSubject: SUB_A,
        ownerName: "Alice",
        kycLevel: "card",
        ...subscription,
      },
    ],
    numbers: [activeNumber("num_a", NUM_A, A)],
    profiles: { [A]: PROVISIONED_PROFILE }, // Phase S: Profil keyt auf die tenantId
  });
  s.usageEvents = usageEvents;
  if (usage) s.usage = usage;
  return s;
}

// Abo mit laufendem persistierten Periodenanker (current_period_start vor 5 Tagen).
const STARTER_SUB = { stripePlanSlug: "starter", stripeCurrentPeriodStart: fiveDaysAgoSec };

// PAYMENT_ENABLED an (Boot-Pflichten: STRIPE_SECRET_KEY/WEBHOOK_SECRET, FEE > 0). STRIPE_API_BASE
// zeigt ins Leere (kein Netz-Call in diesen Tests). MULTI_TENANT an -> der Identitaets-Header
// keyt den Request-Tenant. ALLOWED_NUMBERS = TO, damit das Land-/Format-Gate TO durchlaesst.
const PAY_ENV = {
  MULTI_TENANT: "true",
  ALLOWED_NUMBERS: TO,
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: "http://127.0.0.1:9",
  NUMBER_SETUP_FEE_CENTS: "500",
};
const PAY_OFF_ENV = { MULTI_TENANT: "true", ALLOWED_NUMBERS: TO }; // PAYMENT_ENABLED default false

function placeCall(srv, identity, body = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
}

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

// Build-Operate-Check: Server starten, Outbound versuchen, Roh-Body + Status + Call-Zahl
// zurueck (402-Bodies sind JSON-Strings -> match auf dem Roh-Text, kein parse noetig; der
// Offline-500-Body ist kein JSON). Server in finally beenden.
async function tryOutbound(env, seed, identity) {
  const srv = await startServer({ env, seed });
  try {
    const res = await placeCall(srv, identity);
    return { status: res.status, body: await res.text(), callCount: outboundCallsTo(srv).length };
  } finally {
    await srv.stop();
  }
}

// (1) Erschoepfter Subscriber -> 402 grund=minutes, KEIN Call.
test("erschoepfte Plan-Minuten blocken den Outbound (402 grund=minutes), KEIN Call", async () => {
  const seed = seedQuota({
    subscription: STARTER_SUB,
    usageEvents: [voiceMinuteEvent(A, STARTER_MIN)], // >= includedMinutes -> exceeded
  });
  const { status, body, callCount } = await tryOutbound(PAY_ENV, seed, SUB_A);
  assert.equal(status, 402, "Minuten erschoepft -> geblockt");
  assert.match(body, /Plan-Minuten/, "Minuten-Meldung (eigene Achse)");
  assert.equal(callCount, 0, "Block VOR createCall -> kein Call-Record");
});

// (2) Beide Achsen unabhaengig: getrennte ifs, keine Doppelzaehlung. (a) Minuten leer +
// Budget erschoepft -> Budget-Gate feuert ZUERST (/budget limit/). (b) Minuten erschoepft +
// Budget frisch -> Minuten-Gate (/Plan-Minuten/). Zwei verschiedene Meldungen = Trennung.
test("Minuten- und Budget-Achse sind getrennt (verschiedene 402-Meldungen)", async () => {
  const budgetSeed = seedQuota({
    subscription: STARTER_SUB,
    usageEvents: [], // Minuten frisch
    usage: { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(99) }, // 99 >= MAX_BUDGET_EUR(30, LCT P6)
  });
  const budgetRes = await tryOutbound(PAY_ENV, budgetSeed, SUB_A);
  assert.equal(budgetRes.status, 402, "Budget erschoepft -> geblockt");
  assert.match(budgetRes.body, /budget limit/, "Budget-Gate feuert VOR dem Minuten-Gate");

  const minutesSeed = seedQuota({
    subscription: STARTER_SUB,
    usageEvents: [voiceMinuteEvent(A, STARTER_MIN)], // Minuten erschoepft, Budget frisch
  });
  const minutesRes = await tryOutbound(PAY_ENV, minutesSeed, SUB_A);
  assert.equal(minutesRes.status, 402, "Minuten erschoepft -> geblockt");
  assert.match(minutesRes.body, /Plan-Minuten/, "eigenes Minuten-Gate, getrenntes if");
});

// (3) Owner/Bootstrap haelt keinen Plan und wird NIE minuten-gesperrt: localhost ohne
// Identitaet -> requestTenant = BOOTSTRAP -> Gate uebersprungen -> Originate (500).
test("Owner/Bootstrap nie minuten-gesperrt (kein Plan) -> erreicht Originate (500)", async () => {
  const seed = seedQuota({ subscription: STARTER_SUB, usageEvents: [voiceMinuteEvent(A, STARTER_MIN)] });
  const { status, callCount } = await tryOutbound(PAY_ENV, seed, null); // kein Identitaets-Header
  assert.equal(status, 500, "Owner uebergeht das Gate, scheitert erst am Offline-Originate");
  assert.equal(callCount, 1, "Owner-Call wird erzeugt (nicht geblockt)");
});

// (4) Fail-closed (§5.4): aktiver Subscriber ohne Plan/Anker -> planMinutesExceeded true ->
// 402. ABSICHT (kein Fail-Open-Misfix): ein spaeterer Fixer darf das NICHT "reparieren".
test("fail-closed: aktiver Subscriber OHNE Plan -> 402 grund=minutes (absichtlich)", async () => {
  const seed = seedQuota({ subscription: {}, usageEvents: [] }); // kein stripePlanSlug/-Anker
  const { status, body, callCount } = await tryOutbound(PAY_ENV, seed, SUB_A);
  assert.equal(status, 402, "kein Plan -> fail-closed blocken");
  assert.match(body, /Plan-Minuten/, "fail-closed ueber das Minuten-Gate");
  assert.equal(callCount, 0, "kein Call");
});

// (5) Bestands-Fallback (§5.4): NULL current_period_start, aber gueltiges currentPeriodEnd
// -> abgeleiteter Anker -> used 0 < Kontingent -> NICHT gesperrt (Originate 500). Verhindert
// die Massensperrung zahlender Bestandskunden beim Scharfschalten.
test("Bestands-Tenant NULL current_period_start + gueltiges currentPeriodEnd -> NICHT gesperrt", async () => {
  const seed = seedQuota({
    subscription: { stripePlanSlug: "starter", stripeCurrentPeriodEnd: twentyFiveDaysAheadSec },
    usageEvents: [], // 0 Minuten im abgeleiteten Fenster
  });
  const { status } = await tryOutbound(PAY_ENV, seed, SUB_A);
  assert.equal(status, 500, "abgeleiteter Anker, used 0 < Kontingent -> passiert das Gate");
});

// (6) PAYMENT_ENABLED=false -> Gate No-Op (byte-identisch). Gleicher erschoepfter Seed.
test("PAYMENT_ENABLED=false: Minuten-Gate ist No-Op -> erreicht Originate (500)", async () => {
  const seed = seedQuota({ subscription: STARTER_SUB, usageEvents: [voiceMinuteEvent(A, STARTER_MIN)] });
  const { status } = await tryOutbound(PAY_OFF_ENV, seed, SUB_A);
  assert.equal(status, 500, "ohne Payment greift das Gate nicht -> Originate");
});

// (7) Inbound NICHT minuten-gegated (§5.2): erschoepfte Minuten, Budget frisch, PAYMENT an
// -> normale Begruessung (200, A's ownerName), KEIN budgetExhaustedHangup.
test("Inbound nicht minuten-gegated: erschoepfte Minuten -> normale Begruessung (200)", async () => {
  const seed = seedQuota({ subscription: STARTER_SUB, usageEvents: [voiceMinuteEvent(A, STARTER_MIN)] });
  const srv = await startServer({ env: PAY_ENV, seed });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915199999999", To: NUM_A }),
    });
    assert.equal(res.status, 200, "Inbound trotz erschoepfter Minuten erreichbar");
    assert.match(await res.text(), /Alice/, "normale Begruessung mit A's ownerName, kein Budget-Hangup");
  } finally {
    await srv.stop();
  }
});

// (8) Reine Unit resolvePeriodStartIso (backend-frei): Praezedenz + Grenzfaelle.
test("resolvePeriodStartIso: persistierter Start hat Vorrang, sonst End-Ableitung, sonst null", () => {
  const startSec = 1_700_000_000;
  const endSec = 1_703_000_000;
  assert.equal(
    resolvePeriodStartIso({ currentPeriodStart: startSec }),
    new Date(startSec * 1000).toISOString(),
    "persistierter Start -> ISO davon",
  );
  assert.equal(
    resolvePeriodStartIso({ currentPeriodStart: startSec, currentPeriodEnd: endSec }),
    new Date(startSec * 1000).toISOString(),
    "Start hat Vorrang vor End (Praezedenz 1 vor 2)",
  );
  assert.equal(
    resolvePeriodStartIso({ currentPeriodEnd: endSec }),
    periodStartFromEnd(endSec).toISOString(),
    "nur End -> abgeleiteter Anker (Bestands-Fallback)",
  );
  assert.equal(
    resolvePeriodStartIso({ currentPeriodStart: 0 }),
    new Date(0).toISOString(),
    "0 ist ein Wert, kein fehlender Anker (!= null, nicht falsy)",
  );
  assert.equal(resolvePeriodStartIso({ currentPeriodStart: null, currentPeriodEnd: null }), null, "beide null -> null");
  assert.equal(resolvePeriodStartIso(), null, "leeres Arg -> null (fail-closed an den Aufrufer)");
});
