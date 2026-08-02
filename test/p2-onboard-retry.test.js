// P2 - Operator-Re-Trigger POST /api/onboard/retry: re-provisioniert eine Nummer fuer einen
// aktiven, bezahlten Subscriber, dessen vorheriger Nummernkauf scheiterte (provisionNumber
// faellt bei Order-Fehler auf 'failed' -> tenantHasLiveNumber wieder offen -> frische
// 'requested'). Geld-Safety (Regel 1): NUR active + KYC>=CARD Subscriber.
//
// AUTH-P6: /api/onboard/retry ist seither eine Betreiber-Route (webAuthMw+adminMw, nur
// MIT operatorAuth gemountet) - ein echter Spawn-Server (json/kein SESSION_SECRET)
// mountet sie darum gar nicht mehr (empirisch: (a)/(b)/(c) faellen als Spawn-Tests auf
// 404 statt 200/409/403 - DEVIATION vom Plan-Abschnitt "2 von 4": tatsaechlich brauchen
// DREI der vier Tests die Migration, nicht zwei, weil sie alle durch die Route selbst
// antworten muessen, nicht durch das Gate davor). (a)-(c) migriert auf In-Process-Mount
// von makeOnboardRoutes + Provisioning-Double, das die Reason-Codes liefert (Muster
// onboarding-route.test.js); das Reason->Status-Mapping (RETRY_REASON_STATUS) bleibt
// wortgleich gepinnt. (d) bleibt UNVERAENDERT (echter Spawn-Server): kein SESSION_SECRET
// im env(idp)-Fixture -> operatorAuth existiert nicht -> die Route ist gar nicht
// gemountet (404), unabhaengig vom X-Forwarded-For-Header. Seit AUTH-P7 gibt es kein
// Gate mehr, das stattdessen 401 antworten koennte.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, seedState, startIdp } from "./helpers.js";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState, tenantActiveSubscriber } from "../src/store/state-ops.js";
import { KYC_LEVEL, NUMBER_STATUS } from "../src/store/defaults.js";

// active + CARD = der zahlende Subscriber (tenantActiveSubscriber true).
function subscriberTenant(id, idpSubject) {
  return { id, status: "active", idpSubject, ownerName: `${id} Tester`, kycLevel: KYC_LEVEL.CARD };
}

// ---- (a)-(c): In-Process-Mount, Provisioning-Double liefert die Reason-Codes --------

// Aufrufspur-Attrappe: wirft, wenn sie aufgerufen wird, obwohl kein Test das erwartet
// (Muster onboarding-route.test.js) - so faellt ein Regressions-Aufruf laut auf statt
// still durchzurutschen.
function neverCalledProvisioning() {
  return {
    triggerTenantProvisioning: async () => {
      throw new Error("triggerTenantProvisioning darf hier NIE aufgerufen werden (Geld-Safety-Guard davor)");
    },
  };
}

function fixedResultProvisioning(result) {
  return { triggerTenantProvisioning: async () => result };
}

async function startRetryApp({ state, provisioning }) {
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: {
        load: () => state,
        save: () => {},
        withStoreLock: (fn) => Promise.resolve().then(fn),
        resolveTenant: () => null,
        tenantActiveSubscriber: (tenantId, minLevel) => tenantActiveSubscriber(state, tenantId, minLevel),
      },
      config: withConfigNamespaces({
        maxNumbers: 100,
        maxNumbersPerTenant: 100,
        provisioningEnabled: false,
        provisioningCountry: "DE",
        forceNumberCountry: "",
        geoEnabled: false,
        defaultTenantBudgetCents: 0,
      }),
      audit: () => {},
      provisioning,
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

const retryInProcess = (app, body) =>
  fetch(`${app.base}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// (a) active+CARD Subscriber ohne Nummer -> Re-Trigger fragt eine Dry-Run-Nummer an.
test("(a) active subscriber ohne Nummer -> 200 dry_run + numberId", async () => {
  const state = { ...makeDefaultState(), tenants: [subscriberTenant("t_retry", "sub-r")] };
  const app = await startRetryApp({
    state,
    provisioning: fixedResultProvisioning({ ok: true, numberId: "num_dryrun1", reason: "dry_run" }),
  });
  try {
    const res = await retryInProcess(app, { tenantId: "t_retry" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.reason, "dry_run", "PROVISIONING_ENABLED aus -> Dry-Run, kein echter Kauf");
    assert.ok(json.numberId, "eine 'requested' Nummer wurde angefragt");
  } finally {
    await app.close();
  }
});

// (b) Tenant mit lebender Nummer -> 409 already_provisioned (Idempotenz, kein Doppelkauf).
test("(b) Tenant mit lebender Nummer -> 409 already_provisioned", async () => {
  const state = {
    ...makeDefaultState(),
    tenants: [subscriberTenant("t_live", "sub-l")],
    numbers: [
      { id: "n_live", tenantId: "t_live", status: NUMBER_STATUS.ACTIVE, e164: "+4915123000001", provider: "telnyx" },
    ],
  };
  const app = await startRetryApp({
    state,
    provisioning: fixedResultProvisioning({ ok: false, reason: "already_provisioned" }),
  });
  try {
    const res = await retryInProcess(app, { tenantId: "t_live" });
    assert.equal(res.status, 409);
  } finally {
    await app.close();
  }
});

// (c) Geld-Safety: suspendierter ODER unbekannter Tenant -> 403 (kein Nummernkauf fuer
// Nicht-Zahler). Beweist die active+CARD-Vorbedingung VOR jedem Provider-Pfad -
// neverCalledProvisioning() beweist strukturell, dass der Guard vor dem Double greift.
test("(c) suspendierter/unbekannter Tenant -> 403 (Geld-Safety, kein Kauf)", async () => {
  const state = {
    ...makeDefaultState(),
    tenants: [{ id: "t_susp", status: "suspended", idpSubject: "sub-s", ownerName: "S", kycLevel: KYC_LEVEL.CARD }],
  };
  const app = await startRetryApp({ state, provisioning: neverCalledProvisioning() });
  try {
    assert.equal((await retryInProcess(app, { tenantId: "t_susp" })).status, 403, "suspendiert -> 403");
    assert.equal((await retryInProcess(app, { tenantId: "t_unknown" })).status, 403, "unbekannt -> 403");
  } finally {
    await app.close();
  }
});

// ---- (d): UNVERAENDERT (echter Spawn-Server, misst das Gate) ------------------------

// nicht-AC TWILIO_ACCOUNT_SID -> Twilio-Client wirft synchron VOR Netzzugriff (offline).
const OFFLINE = { TWILIO_ACCOUNT_SID: "x" };
const PW = "retry-secret";

const env = (idp) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  DASHBOARD_PASSWORD: PW,
  MAX_NUMBERS: "100",
  MAX_NUMBERS_PER_TENANT: "100",
  ...OFFLINE,
});

const retry = (srv, body, headers = {}) =>
  fetch(`${srv.localUrl}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

// (d) Auth fail-closed (Regel 3): kein SESSION_SECRET im Fixture -> operatorAuth
// existiert nicht -> die Route ist gar nicht gemountet. Ein proxy-weitergereichter
// Request (X-Forwarded-For) trifft darum auf Express' eigenen 404, unabhaengig vom
// Header - seit AUTH-P7 gibt es kein Gate mehr, das VOR der Route-Existenz-Frage
// antworten wuerde (s. scripts/probe-auth.sh).
test("(d) proxied ohne Admin-Sitzung -> 404 (Route ohne operatorAuth nicht gemountet)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({ tenants: [subscriberTenant("t_auth", "sub-a")] }),
  });
  try {
    const res = await retry(srv, { tenantId: "t_auth" }, { "X-Forwarded-For": "1.2.3.4" });
    assert.equal(res.status, 404);
  } finally {
    await srv.stop();
    await idp.close();
  }
});
