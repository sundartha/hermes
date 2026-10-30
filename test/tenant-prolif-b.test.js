import { test } from "node:test";
import assert from "node:assert/strict";
import { neuePglite } from "./pglite-helfer.js";
import { makePgStore } from "../src/store/pg.js";
import { makeAccounts } from "../src/web-auth.js";
import { tenantIdForSubject } from "../src/store/defaults.js";
import { checkSubAlreadyMerged, SUB_ALREADY_MERGED_ERROR } from "../src/onboard-guard.js";

const runnerFor = (db) => ({
  withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
});

const SHARED_EMAIL = "shared@x";
const SUB_1 = "u1";
const SUB_2 = "u2";
const TENANT_1 = tenantIdForSubject(SUB_1);

test("tenant-prolif-b: init() hydriert subIndex aus account -> gemergter sub2 loest kanonisch auf", async () => {
  const db = await neuePglite();
  const boot = makePgStore(runnerFor(db));
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
  assert.equal(reborn.resolveTenant(SUB_1), TENANT_1);
  assert.equal(reborn.resolveTenant(SUB_2), TENANT_1, "gemergter Zweit-sub loest auf den kanonischen Tenant");
  assert.equal(
    reborn.resolveTenant(SUB_1),
    reborn.resolveTenant(SUB_2),
    "beide subs -> derselbe Tenant",
  );
});

test("tenant-prolif-b: Nach-Boot-Login bindet gemergten sub ohne Neustart (kein Race)", async () => {
  const db = await neuePglite();
  const store = makePgStore(runnerFor(db));
  await store.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  assert.equal(store.resolveTenant(SUB_2), null, "vor dem Bind kennt der Spiegel u2 nicht");
  await store.ensureTenant(TENANT_1);
  store.bindSubToTenant(SUB_2, TENANT_1);
  assert.equal(store.resolveTenant(SUB_2), TENANT_1, "gemergter sub sofort aufloesbar (ohne reinit)");
  assert.equal(
    store.resolveTenant(SUB_1),
    TENANT_1,
    "Primaer-sub via idpSubject-Fallback (ensureTenant zog t_u1)",
  );
});

test("tenant-prolif-b: Onboard-Guard-Bedingung - resolveTenant(gemergt) != tenantIdForSubject", async () => {
  const db = await neuePglite();
  const boot = makePgStore(runnerFor(db));
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
  const canonical = reborn.resolveTenant(SUB_2);
  assert.equal(canonical, TENANT_1);
  assert.notEqual(
    canonical,
    tenantIdForSubject(SUB_2),
    "u2 wuerde sonst t_u2 als Zweit-Tenant erzeugen",
  );
});

test("checkSubAlreadyMerged: gemergter Zweit-sub -> 409 + Fehlertext (blockt den Zweit-Tenant-Kauf)", async () => {
  const db = await neuePglite();
  const boot = makePgStore(runnerFor(db));
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
  const result = checkSubAlreadyMerged({
    sub: SUB_2,
    tenantId: tenantIdForSubject(SUB_2),
    resolveTenant: reborn.resolveTenant,
  });
  assert.deepEqual(result, { status: 409, error: SUB_ALREADY_MERGED_ERROR });
});

test("checkSubAlreadyMerged: Primaer-sub (canonical === tenantId) -> null (kein falscher 409)", async () => {
  const db = await neuePglite();
  const boot = makePgStore(runnerFor(db));
  await boot.init();
  const accounts = makeAccounts(runnerFor(db));
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  const reborn = makePgStore(runnerFor(db));
  await reborn.init();
  const result = checkSubAlreadyMerged({
    sub: SUB_1,
    tenantId: tenantIdForSubject(SUB_1),
    resolveTenant: reborn.resolveTenant,
  });
  assert.equal(result, null);
});

test("checkSubAlreadyMerged: isoliert ohne Store - unbekannter sub -> null, sub-los (Operator-Pfad) -> null", () => {
  const noMatch = checkSubAlreadyMerged({
    sub: "unbekannt",
    tenantId: "t_unbekannt",
    resolveTenant: () => null,
  });
  assert.equal(noMatch, null, "resolveTenant liefert null -> kein Treffer, kein 409");

  const noSub = checkSubAlreadyMerged({
    sub: null,
    tenantId: "t_operator",
    resolveTenant: () => {
      throw new Error("resolveTenant darf ohne sub nie aufgerufen werden");
    },
  });
  assert.equal(noSub, null, "Operator-Pfad ohne idpSubject bleibt byte-identisch (kein Guard)");
});

import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { KYC_OUTBOUND_MIN } from "../src/store/defaults.js";
import { BOOTSTRAP_TENANT_ID, makePgTestStore } from "./pg-helpers.js";
import { operatorAuthPassThrough, startRouterApp } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { postJson } from "./anrufe/routen-server.js";

const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const SUB_GEMERGT_TEXT = "Dieser Account ist bereits einem Tenant zugeordnet.";
const TENANT_2 = tenantIdForSubject(SUB_2);

function onboardKonfiguration({ maxNumbersPerTenant = 1 } = {}) {
  return withConfigNamespaces({
    maxNumbers: 5,
    maxNumbersPerTenant,
    provisioningEnabled: true,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    geoEnabled: false,
    defaultTenantBudgetCents: 0,
  });
}

function anbieterMitRetryErgebnis(retryErgebnis) {
  const aufrufe = { queueProvisioning: [], triggerTenantProvisioning: [] };
  return {
    aufrufe,
    queueProvisioning: async (numberId, tenantId) => {
      aufrufe.queueProvisioning.push({ numberId, tenantId });
      return { ok: true, jobId: "job_prolif" };
    },
    runProvisioningDrainExclusive: async () => {},
    triggerTenantProvisioning: async (tenantId) => {
      aufrufe.triggerTenantProvisioning.push(tenantId);
      return retryErgebnis;
    },
  };
}

async function onboardingStarten({ store, konfiguration = onboardKonfiguration(), retryErgebnis = null }) {
  const protokoll = [];
  const provisioning = anbieterMitRetryErgebnis(retryErgebnis);
  const router = makeOnboardRoutes({
    store,
    config: konfiguration,
    audit: (aktion, _req, detail) => protokoll.push([aktion, detail]),
    provisioning,
    operatorAuth: operatorAuthPassThrough(),
  });
  const app = await startRouterApp(router);
  const senden = async (pfad, body) => {
    const res = await postJson(`${app.base}${pfad}`, body);
    return { status: res.status, body: await res.json() };
  };
  return { senden, protokoll, provisioning, close: app.close };
}

async function storeMitGemergtemZweitSub() {
  const { store, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  await accounts.upsertOnFirstLogin({ sub: SUB_1, email: SHARED_EMAIL });
  await accounts.upsertOnFirstLogin({ sub: SUB_2, email: SHARED_EMAIL });
  await store.init();
  return store;
}

async function frischGeladen(store) {
  await store.drainFlushes();
  await store.init();
  return store.load();
}

test("[NIE1] Onboarding mit gemergtem Zweit-sub -> 409 mit dem bisherigen Text, kein Tenant, keine Nummer, kein Nummernkauf", async () => {
  const store = await storeMitGemergtemZweitSub();
  const nummernVorher = store.load().numbers.length;
  const onboarding = await onboardingStarten({ store });
  try {
    const antwort = await onboarding.senden("/api/onboard", { idpSubject: SUB_2 });
    assert.deepEqual(antwort, { status: HTTP_CONFLICT, body: { error: SUB_GEMERGT_TEXT } });
    assert.equal(store.load().tenants.some((t) => t.id === TENANT_2), false, "kein Zweit-Tenant im Speicher");
    assert.equal(store.load().numbers.length, nummernVorher, "keine Nummer angefragt");
    assert.deepEqual(onboarding.provisioning.aufrufe.queueProvisioning, [], "kein Nummernkauf angestossen");
    const geladen = await frischGeladen(store);
    assert.equal(geladen.tenants.some((t) => t.id === TENANT_2), false, "kein Zweit-Tenant nach Neuladen");
    assert.equal(geladen.numbers.length, nummernVorher, "keine Nummer nach Neuladen");
  } finally {
    await onboarding.close();
  }
});

test("tenant-prolif-b: abgewiesener gemergter Zweit-sub wird als onboard_denied mit Grund sub_already_merged protokolliert", async () => {
  const store = await storeMitGemergtemZweitSub();
  const onboarding = await onboardingStarten({ store });
  try {
    await onboarding.senden("/api/onboard", { idpSubject: SUB_2 });
    assert.deepEqual(onboarding.protokoll, [
      ["onboard_denied", `tenant=${TENANT_2} grund=sub_already_merged`],
    ]);
  } finally {
    await onboarding.close();
  }
});

test("tenant-prolif-b: Nummer-Anfrage ueber der Tenant-Grenze -> 409, Protokoll mit Grund, abgewiesener Tenant wird nicht gespeichert", async () => {
  const { store } = await makePgTestStore();
  const onboarding = await onboardingStarten({
    store,
    konfiguration: onboardKonfiguration({ maxNumbersPerTenant: 0 }),
  });
  try {
    const antwort = await onboarding.senden("/api/onboard", { tenantId: "t_grenze" });
    assert.deepEqual(antwort, {
      status: HTTP_CONFLICT,
      body: { error: "Nummer-Anfrage abgelehnt (tenant_cap)" },
    });
    assert.deepEqual(onboarding.protokoll, [["onboard_denied", "tenant=t_grenze grund=tenant_cap"]]);
    const geladen = await frischGeladen(store);
    assert.equal(
      geladen.tenants.some((t) => t.id === "t_grenze"),
      false,
      "abgewiesene Anfrage hinterlaesst keinen gespeicherten Tenant",
    );
  } finally {
    await onboarding.close();
  }
});

test("tenant-prolif-b: Retry ohne aktiven, verifizierten Subscriber -> 403 und Protokoll onboard_retry_denied", async () => {
  const { store } = await makePgTestStore();
  const onboarding = await onboardingStarten({ store });
  try {
    const antwort = await onboarding.senden("/api/onboard/retry", { tenantId: "t_ohne_abo" });
    assert.deepEqual(antwort, {
      status: HTTP_FORBIDDEN,
      body: { error: "Kein aktiver, verifizierter Subscriber - kein Nummernkauf." },
    });
    assert.deepEqual(onboarding.protokoll, [
      ["onboard_retry_denied", "tenant=t_ohne_abo grund=kein_aktiver_subscriber"],
    ]);
    assert.deepEqual(onboarding.provisioning.aufrufe.triggerTenantProvisioning, []);
  } finally {
    await onboarding.close();
  }
});

test("tenant-prolif-b: abgelehnter Retry ohne eigene Meldung -> 409 mit Grund im Text und Protokoll onboard_retry", async () => {
  const { store } = await makePgTestStore();
  store.setKycLevel(BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN);
  const onboarding = await onboardingStarten({
    store,
    retryErgebnis: { ok: false, reason: "already_provisioned" },
  });
  try {
    const antwort = await onboarding.senden("/api/onboard/retry", { tenantId: BOOTSTRAP_TENANT_ID });
    assert.deepEqual(antwort, {
      status: HTTP_CONFLICT,
      body: { error: "Re-Provisioning abgelehnt (already_provisioned)" },
    });
    assert.deepEqual(onboarding.protokoll, [
      ["onboard_retry", `tenant=${BOOTSTRAP_TENANT_ID} ok=false grund=already_provisioned`],
    ]);
  } finally {
    await onboarding.close();
  }
});
