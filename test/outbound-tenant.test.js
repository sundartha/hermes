// I7: Outbound tenant-aware (L4 dicht). POST /api/calls loest den Request-Tenant
// ueber requestTenant (I4) auf und belastet pro-Tenant Nummer + Budget statt hart
// BOOTSTRAP_TENANT_ID. Reiner Spawn (startServer + seedState), KEIN pglite in derselben
// Datei (Lehre p6a-Stall: NIE mischen).
//
// Identitaet kommt hier ueber den localhost-only X-Internal-Identity-Header. In der
// Prod-Plumbing traegt dieser Kanal heute email (mcp-tools); die sub-Durchreichung
// ueber REST ist I5. Der Test setzt den Header DIREKT auf den idpSubject - genau den
// gueltigen Aufloesungs-Schluessel von requestTenant/resolveTenant.
//
// EHRLICH dokumentiert: pro-Tenant-Budget UND globaler Notaus nutzen BEIDE
// config.platformSpendCapCents und global = Summe >= jeder Einzel-Bucket. Damit sind die
// beiden Gates am HTTP-Level NICHT voneinander isolierbar (jeder erschoepfte Bucket
// reisst auch die Summe). Die pro-Tenant-KORREKTHEIT wird darum ueber ATTRIBUTION
// bewiesen (call.tenantId + call.from -> daran haengt trackUsage); die reine
// Funktions-Isolation deckt bereits store-pg-tenant-budget.test.js ab. Der globale
// Notaus wird ueber den Summen-Vektor (je Tenant < Cap, Summe >= Cap) als unveraendert
// PARALLEL nachgewiesen.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TO = "+4915112345678"; // erlaubtes Ziel (steht in ALLOWED_NUMBERS), kein Premium/Notruf
const OWNER_NUMBER = "+15005550006"; // = BASE_ENV.TWILIO_NUMBER (config-basierte Owner-Absendernummer)

const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A = "+4915110000001";
const B = "tenant-b",
  SUB_B = "sub-b",
  NUM_B = "+4915110000002";
const C = "tenant-c",
  SUB_C = "sub-c",
  NUM_C = "+4915110000003";

const activeNumber = (id, e164, tenantId, status = "active") => ({
  id,
  e164,
  tenantId,
  provider: "twilio",
  status,
  providerNumberId: null,
});

// A2/A3-provisioniertes Tier-Profil: maxCallsPerHour=null entkoppelt den aktiven
// Subscriber vom DEFAULT_PROFILE(0)-User-Hour-Gate (A4 go-live-Haertung). Minimaler
// Stub - nur das fuer diese Gate-Tests relevante Feld (planProfileFor traegt es real).
// Phase S: das Profil keyt auf die tenantId (A/B/C), nicht mehr auf den idpSubject.
const PROVISIONED_PROFILE = { maxCallsPerHour: null };

// Zwei aktive Tenants (A, B) mit eigener aktiver Nummer + idpSubject. usage/extraNumbers
// optional ueberschreibbar. usage wird als MAP geseedet -> json.load erkennt das Nicht-
// flache Shape und migriert NICHT (jeder Bucket bleibt; migrateUsageToMap).
// A/B/C sind verifizierte Subscriber (kyc=card): seit dem fail-closed kycReached-Flip
// (Phase outbound-p1) sperrt das erste Outbound-Gate jeden Tenant OHNE kyc_level. Diese
// Tests pruefen NICHT das KYC-Gate, sondern Nummer-/Budget-Attribution -> die Tenants
// muessen es passieren (realistischer Subscriber-Zustand). Der Owner heilt sich beim Boot.
function seedTenants({ extraNumbers = [], usage } = {}) {
  const s = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: A, status: "active", idpSubject: SUB_A, ownerName: "Alice", kycLevel: "card" },
      { id: B, status: "active", idpSubject: SUB_B, ownerName: "Bob", kycLevel: "card" },
      { id: C, status: "active", idpSubject: SUB_C, ownerName: "Carol", kycLevel: "card" },
    ],
    numbers: [activeNumber("num_a", NUM_A, A), activeNumber("num_b", NUM_B, B), ...extraNumbers],
    profiles: { [A]: PROVISIONED_PROFILE, [B]: PROVISIONED_PROFILE, [C]: PROVISIONED_PROFILE },
  });
  if (usage) s.usage = usage;
  return s;
}

const bucket = (costEur) => ({ inputTokens: 0, outputTokens: 0, costEur, calls: costEur ? 1 : 0 });

// POST /api/calls ueber localhost (-> X-Internal-Identity gilt). identity = idpSubject
// des Request-Tenants (oder null fuer Owner/localhost-ohne-Identitaet).
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

const FLAG_ON = { MULTI_TENANT: "true", ALLOWED_NUMBERS: TO };

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

// (1) Attribution: A telefoniert unter A's Nummer/tenantId, B unter B's. Beide
// passieren Gates+Budget (fresh) -> erreichen den offline scheiternden Originate (500,
// NICHT 402/403) -> "B nicht geblockt". from ist NIE die Owner-Nummer.
test("Flag an: Outbound attribuiert from + tenantId pro Tenant (A->A-Nummer/A-Budget, B->B-Nummer); B nicht geblockt", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedTenants() });
  try {
    const resA = await placeCall(srv, SUB_A);
    const resB = await placeCall(srv, SUB_B);
    assert.equal(resA.status, 500, "A passiert Gates+Budget, scheitert erst am Offline-Originate");
    assert.equal(resB.status, 500, "B nicht budget-/nummer-geblockt (fresh) -> erreicht Originate");

    const calls = outboundCallsTo(srv);
    const callA = calls.find((c) => c.tenantId === A);
    const callB = calls.find((c) => c.tenantId === B);
    assert.ok(callA, "Call mit tenantId=A erzeugt");
    assert.equal(
      callA.from,
      NUM_A,
      "A telefoniert unter EIGENER aktiver Nummer (-> A-Budget via tenantId)",
    );
    assert.ok(callB, "Call mit tenantId=B erzeugt");
    assert.equal(callB.from, NUM_B, "B telefoniert unter EIGENER aktiver Nummer");
    assert.ok(
      !calls.some((c) => c.from === OWNER_NUMBER),
      "NIE Owner-Nummer fuer einen Fremd-Tenant",
    );
  } finally {
    await srv.stop();
  }
});

// (2) Negativ-Vektor (Toll-Fraud-Riegel): Tenant ohne EIGENE AKTIVE Nummer (nur eine
// suspendierte) -> Reject, KEIN Call, NIE Fallback auf die Owner-Nummer.
test("Flag an: Tenant ohne eigene AKTIVE Nummer -> 403 Reject, KEIN Call, NIE Owner-Nummer", async () => {
  const seed = seedTenants({ extraNumbers: [activeNumber("num_c", NUM_C, C, "suspended")] });
  const srv = await startServer({ env: FLAG_ON, seed });
  try {
    const res = await placeCall(srv, SUB_C);
    assert.equal(res.status, 403, "keine aktive eigene Nummer -> Reject (NICHT Owner-Nummer)");
    assert.match((await res.json()).error, /Nummer/i);

    assert.equal(outboundCallsTo(srv).length, 0, "Reject VOR createCall -> kein Call erzeugt");
    assert.ok(
      !srv.readStore().calls.some((c) => c.from === OWNER_NUMBER),
      "NIE Owner-Nummer als Fremd-Tenant-Fallback",
    );
  } finally {
    await srv.stop();
  }
});

// (2b) Vorhandene aber unbekannte Identitaet -> Reject (fail-closed, NIE Owner).
test("Flag an: unbekannte Identitaet -> 403 Reject (NIE Owner-Tenant)", async () => {
  const srv = await startServer({ env: FLAG_ON, seed: seedTenants() });
  try {
    const res = await placeCall(srv, "sub-voellig-unbekannt");
    assert.equal(res.status, 403, "unbekannter idpSubject -> Reject, kein Owner-Fallback");
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call erzeugt");
  } finally {
    await srv.stop();
  }
});

// (3) Pro-Tenant-Budget erschoepft -> der Tenant ist geblockt, kein Call entsteht.
test("Flag an: erschoepftes Tenant-Budget blockt den Tenant (402), KEIN Call", async () => {
  const seed = seedTenants({ usage: { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(99) } }); // 99 >= MAX_BUDGET_EUR(8)
  const srv = await startServer({ env: FLAG_ON, seed });
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 402, "A-Budget erschoepft -> A geblockt");
    assert.equal(
      outboundCallsTo(srv).length,
      0,
      "kein Call bei Budget-Block (Reject vor createCall)",
    );
  } finally {
    await srv.stop();
  }
});

// (4) Globaler Notaus PARALLEL/unveraendert: je Tenant UNTER dem Cap, aber die SUMME
// reisst ihn -> 402. Wuerde der globale Notaus durch den pro-Tenant-Bucket ERSETZT
// (Schnittmenge gebrochen), liefe A (5 < 8) durch -> dieser Test faengt das.
test("Flag an: globaler Notaus greift bei Summe (je Tenant < Cap) -> 402; global unveraendert", async () => {
  const seed = seedTenants({
    usage: { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(5), [B]: bucket(5) },
  }); // 5+5=10 >= 8
  const srv = await startServer({ env: FLAG_ON, seed });
  try {
    const res = await placeCall(srv, SUB_A); // A einzeln 5 < Cap 8, aber Summe 10 >= 8
    assert.equal(
      res.status,
      402,
      "globaler Notaus blockt, obwohl A unter dem pro-Tenant-Cap liegt",
    );
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei globalem Notaus");
  } finally {
    await srv.stop();
  }
});

// (5) Flag AUS = byte-identisch: selbst mit gueltigem A-Identitaets-Header bleibt der
// Outbound Owner-gepinnt (tenantId=owner, config-Owner-Nummer, NICHT A's Nummer).
test("Flag AUS: Identitaets-Header wird fuer den Tenant ignoriert -> Owner-Nummer + tenantId=owner", async () => {
  const srv = await startServer({ env: { ALLOWED_NUMBERS: TO }, seed: seedTenants() }); // MULTI_TENANT default false
  try {
    const res = await placeCall(srv, SUB_A);
    assert.equal(res.status, 500, "Owner-Pfad erreicht den Originate (offline 500)");

    const call = outboundCallsTo(srv)[0];
    assert.ok(call, "Call erzeugt");
    assert.equal(
      call.tenantId,
      BOOTSTRAP_TENANT_ID,
      "Flag aus -> tenantId=owner (Tenant-Achse inaktiv)",
    );
    assert.equal(call.from, OWNER_NUMBER, "Flag aus -> config-Owner-Nummer, NICHT A's Nummer");
  } finally {
    await srv.stop();
  }
});
