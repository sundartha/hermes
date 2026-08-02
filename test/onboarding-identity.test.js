// Identitaets-Schreibseite des Onboardings (I3): POST /api/onboard setzt
// tenant.ownerName (set-on-create), und auf der aktiv gewordenen Nummer NENNT der
// Inbound-Greeting diesen Namen (Identitaets-Kreis = DoD).
//
// AUTH-P6: /api/onboard ist seither eine Betreiber-Route (webAuthMw+adminMw, nur MIT
// operatorAuth gemountet) - ein echter Spawn-Server (json/kein SESSION_SECRET) mountet
// sie darum gar nicht mehr. (1)-(2d) migriert auf In-Process-Mount von makeOnboardRoutes
// (Muster onboarding-route.test.js) - reine Identitaets-Assertionen, 1:1 uebertragbar.
// (3) IDENTITAETS-KREIS bleibt ein Zwei-Schritt-Beweis, aber der erste Schritt
// (onboard + Kauf) laeuft jetzt in-process mit einem Provisioning-Double, das den Kauf
// SYNCHRON simuliert (state.numbers direkt auf 'active' gesetzt, wie es der echte
// Worker am Ende tut) - der resultierende Store-Zustand wird DANACH als Seed in einen
// echten Spawn-Server (/voice/incoming ist unveraendert erreichbar) gegeben, der die
// Inbound-Seite des Kreises misst.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, seedState } from "./helpers.js";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import { tenantIdForSubject } from "../src/store/defaults.js";

const OWNER_NAME = "Maria";

function onboardConfig(overrides = {}) {
  return withConfigNamespaces({
    maxNumbers: 5,
    maxNumbersPerTenant: 1,
    provisioningEnabled: false,
    provisioningCountry: "DE",
    forceNumberCountry: "",
    geoEnabled: false,
    defaultTenantBudgetCents: 0,
    ...overrides,
  });
}

async function startOnboardApp({ state = makeDefaultState(), config = onboardConfig(), provisioning } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: {
        load: () => state,
        save: () => {},
        withStoreLock: (fn) => Promise.resolve().then(fn),
        resolveTenant: (sub) => state.tenants.find((t) => t.idpSubject === sub)?.id ?? null,
      },
      config,
      audit: () => {},
      provisioning: provisioning ?? {
        queueProvisioning: async () => ({ ok: true, jobId: "job_test1" }),
        runProvisioningDrainExclusive: async () => {},
      },
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((r) => server.close(r)),
  };
}

const postJson = (app, path, body) =>
  fetch(`${app.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// (1) onboard MIT firstName (Dry-Run, G1) -> Tenant-Record traegt komponierten ownerName
test("onboard mit firstName -> Tenant-Record traegt ownerName", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", { tenantId: "t_maria", firstName: OWNER_NAME });
    assert.equal(res.status, 200);
    const t = app.state.tenants.find((x) => x.id === "t_maria");
    assert.equal(t.ownerName, OWNER_NAME); // firstName-only -> ownerName === firstName
    assert.equal(t.firstName, OWNER_NAME);
  } finally {
    await app.close();
  }
});

// (2) onboard OHNE Namen -> Record OHNE ownerName-Feld (Rueckwaerts-Kompat)
test("onboard ohne Namen -> Record ohne ownerName-Feld (Owner-Fallback)", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", { tenantId: "t_plain" });
    assert.equal(res.status, 200);
    const t = app.state.tenants.find((x) => x.id === "t_plain");
    assert.ok(!("ownerName" in t), "kein leeres/gesetztes ownerName-Feld am Record");
  } finally {
    await app.close();
  }
});

// (2b) P0: onboard MIT idpSubject -> kanonische tenantId (t_<sub>), idp-gebunden.
// Genau EIN Record, kein zweiter (email-artiger) Record. resolveTenant (MCP/REST)
// findet danach denselben Tenant wie der Web-Login (t_<sub>).
test("onboard mit idpSubject -> genau ein idp-gebundener Tenant t_<sub>", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", { idpSubject: "sub-maria", firstName: OWNER_NAME });
    assert.equal(res.status, 200);
    const tenants = app.state.tenants.filter((t) => t.idpSubject === "sub-maria");
    assert.equal(tenants.length, 1); // 1:1, kein Zweit-Record
    assert.equal(tenants[0].id, "t_sub-maria"); // kanonische ID aus tenantIdForSubject
    assert.equal(tenants[0].ownerName, OWNER_NAME);
  } finally {
    await app.close();
  }
});

// AUTH-P4-7 (aus test/auth-p4-deleted-routes.test.js hierher gewandert, AUTH-P6): der
// validIdentity-Umzug aus _validation.js bleibt am 400-Fehlertext nachweisbar -
// IDENTITY_MAX_LEN muss mit umgezogen und interpoliert sein (254). Der Boot-Beweis
// selbst (spawnt der Prozess ohne SyntaxError beim Laden von api-onboard.js?) bleibt
// dort als Spawn-Test; hier nur die Fachlogik-Assertion, jetzt in-process.
test("AUTH-P4-7: tenantId/idpSubject-Validierung traegt IDENTITY_MAX_LEN=254 im Fehlertext", async () => {
  const app = await startOnboardApp();
  try {
    const badTenant = await postJson(app, "/api/onboard", { tenantId: "a b" });
    assert.equal(badTenant.status, 400);
    const tenantErr = (await badTenant.json()).error;
    assert.match(tenantErr, /tenantId/);
    assert.match(tenantErr, /254/, "IDENTITY_MAX_LEN muss mit umgezogen und interpoliert sein");

    const badSub = await postJson(app, "/api/onboard", { idpSubject: "a b", tenantId: "t_ok" });
    assert.equal(badSub.status, 400);
    assert.match((await badSub.json()).error, /idpSubject/);
  } finally {
    await app.close();
  }
});

// (2c) P0: leeres/Whitespace-idpSubject -> 400 (fail-closed, kein stiller Owner-Pfad).
test("onboard mit Whitespace-idpSubject -> 400", async () => {
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, "/api/onboard", { idpSubject: "  " });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

// (2d) tenant-prolif-b: onboard MIT einem BEREITS (per Email-Merge, Phase A) gemergten
// idpSubject -> 409, KEIN Zweit-Tenant, KEIN Nummer-Request (die Wurzel dieser Kette,
// end-to-end gegen die echte Route statt nur die Vorbedingung). Der Merge-Zustand wird
// hier direkt geseedet (tenant.idpSubject auf einem FREMDEN Tenant-Record) - derselbe
// resolveTenant-Fallback-Pfad (1:1-idpSubject-Scan), den auch der subIndex-Merge-Fall
// (test/tenant-prolif-b.test.js) ueber den anderen Pfad (subIndex) trifft; beide muenden
// im selben Guard (checkSubAlreadyMerged, src/onboard-guard.js).
const MERGED_SUB = "sub-merged-owner";
const CANONICAL_TENANT_ID = "t_canonical_owner"; // != tenantIdForSubject(MERGED_SUB)

test("onboard mit gemergtem idpSubject -> 409, kein Zweit-Tenant, keine Zweit-Nummer", async () => {
  const seed = seedState({
    tenants: [{ id: CANONICAL_TENANT_ID, status: "active", idpSubject: MERGED_SUB }],
    numbers: [],
  });
  const app = await startOnboardApp({ state: seed });
  try {
    const before = app.state.tenants.length;
    const res = await postJson(app, "/api/onboard", { idpSubject: MERGED_SUB, firstName: "Zweit" });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /bereits einem Tenant zugeordnet/);
    assert.equal(app.state.tenants.length, before, "kein Zweit-Tenant angelegt");
    assert.ok(
      !app.state.tenants.some((t) => t.id === tenantIdForSubject(MERGED_SUB)),
      "t_sub-merged-owner (Zweit-Tenant) wurde NICHT erzeugt",
    );
    assert.equal(
      app.state.numbers.filter((n) => n.tenantId === tenantIdForSubject(MERGED_SUB)).length,
      0,
      "kein Nummer-Request fuer den verhinderten Zweit-Tenant (kein Telnyx-DID-Kauf)",
    );
  } finally {
    await app.close();
  }
});

// (3) IDENTITAETS-KREIS (DoD): onboard SETZT -> Inbound auf die aktiv gewordene
// Nummer NENNT den Namen. Schritt 1 (in-process, PROVISIONING_ENABLED simuliert): das
// Provisioning-Double schreibt die Nummer SYNCHRON auf 'active' (wie es der echte
// Worker am Ende des Kaufs tut, hier ohne Telnyx-Netzwerk). Schritt 2 (Spawn): der
// resultierende Store-Zustand geht als Seed in einen echten Server, der /voice/incoming
// unveraendert bedient (kein AUTH-P6-Betroffener).
test("Identitaets-Kreis: onboard firstName + aktive Nummer -> Inbound nennt Maria", async () => {
  const ACTIVE_E164 = "+4915799990001";
  const onboardApp = await startOnboardApp({
    config: onboardConfig({ provisioningEnabled: true, maxNumbers: 10 }),
    provisioning: {
      queueProvisioning: async (numberId) => {
        const num = onboardApp.state.numbers.find((n) => n.id === numberId);
        num.e164 = ACTIVE_E164;
        num.status = "active";
        num.providerNumberId = "num_ext_1";
        return { ok: true, jobId: "job_identity1" };
      },
      runProvisioningDrainExclusive: async () => {},
    },
  });
  try {
    const onb = await postJson(onboardApp, "/api/onboard", { tenantId: "t_maria", firstName: OWNER_NAME });
    const j = await onb.json();
    assert.equal(j.provisioning, "queued");
    const num = onboardApp.state.numbers.find((n) => n.id === j.numberId);
    assert.equal(num.status, "active");
    assert.equal(num.e164, ACTIVE_E164);
  } finally {
    await onboardApp.close();
  }

  const srv = await startServer({ seed: onboardApp.state });
  try {
    const inbound = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAm", From: "+4915112345678", To: ACTIVE_E164 }),
    });
    assert.equal(inbound.status, 200);
    assert.match(await inbound.text(), /Maria/);
  } finally {
    await srv.stop();
  }
});
