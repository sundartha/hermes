// P2 - Operator-Re-Trigger POST /api/onboard/retry: re-provisioniert eine Nummer fuer einen
// aktiven, bezahlten Subscriber, dessen vorheriger Nummernkauf scheiterte (provisionNumber
// faellt bei Order-Fehler auf 'failed' -> tenantHasLiveNumber wieder offen -> frische
// 'requested'). Geld-Safety (Regel 1): NUR active + KYC>=CARD Subscriber. Owner-gated
// (globale Basic-Auth ODER trusted-localhost, Regel 3). Spawn, offline, Dry-Run
// (PROVISIONING_ENABLED aus -> kein echter Kauf). Requests aus dem Test-Prozess sind
// trusted-localhost (Loopback ohne X-Forwarded-For) -> Basic-Auth-exempt; (d) erzwingt den
// Auth-Riegel ueber ein gesetztes X-Forwarded-For.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, startIdp } from "./helpers.js";
import { KYC_LEVEL, NUMBER_STATUS } from "../src/store/defaults.js";

// nicht-AC TWILIO_ACCOUNT_SID -> Twilio-Client wirft synchron VOR Netzzugriff (offline).
const OFFLINE = { TWILIO_ACCOUNT_SID: "x" };
const PW = "retry-secret";

// Caps hoch -> der Cap-Pfad steht (a) nicht im Weg (er ist in bk3 separat getestet).
const env = (idp) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  DASHBOARD_PASSWORD: PW,
  MAX_NUMBERS: "100",
  MAX_NUMBERS_PER_TENANT: "100",
  ...OFFLINE,
});

// active + CARD = der zahlende Subscriber (tenantActiveSubscriber true).
function subscriberTenant(id, idpSubject) {
  return { id, status: "active", idpSubject, ownerName: `${id} Tester`, kycLevel: KYC_LEVEL.CARD };
}

const retry = (srv, body, headers = {}) =>
  fetch(`${srv.localUrl}/api/onboard/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

// (a) active+CARD Subscriber ohne Nummer -> Re-Trigger fragt eine Dry-Run-Nummer an.
test("(a) active subscriber ohne Nummer -> 200 dry_run + numberId", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({ tenants: [subscriberTenant("t_retry", "sub-r")] }),
  });
  try {
    const res = await retry(srv, { tenantId: "t_retry" }); // trusted-localhost -> Basic-Auth-exempt
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.reason, "dry_run", "PROVISIONING_ENABLED aus -> Dry-Run, kein echter Kauf");
    assert.ok(json.numberId, "eine 'requested' Nummer wurde angefragt");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// (b) Tenant mit lebender Nummer -> 409 already_provisioned (Idempotenz, kein Doppelkauf).
test("(b) Tenant mit lebender Nummer -> 409 already_provisioned", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({
      tenants: [subscriberTenant("t_live", "sub-l")],
      numbers: [
        {
          id: "n_live",
          tenantId: "t_live",
          status: NUMBER_STATUS.ACTIVE,
          e164: "+4915123000001",
          provider: "telnyx",
        },
      ],
    }),
  });
  try {
    const res = await retry(srv, { tenantId: "t_live" });
    assert.equal(res.status, 409);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// (c) Geld-Safety: suspendierter ODER unbekannter Tenant -> 403 (kein Nummernkauf fuer
// Nicht-Zahler). Beweist die active+CARD-Vorbedingung VOR jedem Provider-Pfad.
test("(c) suspendierter/unbekannter Tenant -> 403 (Geld-Safety, kein Kauf)", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({
      tenants: [
        {
          id: "t_susp",
          status: "suspended",
          idpSubject: "sub-s",
          ownerName: "S",
          kycLevel: KYC_LEVEL.CARD,
        },
      ],
    }),
  });
  try {
    assert.equal((await retry(srv, { tenantId: "t_susp" })).status, 403, "suspendiert -> 403");
    assert.equal((await retry(srv, { tenantId: "t_unknown" })).status, 403, "unbekannt -> 403");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// (d) Auth fail-closed (Regel 3): ein proxy-weitergereichter Request (X-Forwarded-For) ist
// NICHT trusted-localhost -> ohne Basic-Auth 401. Der Owner-Gate-Riegel des Geld-Endpoints.
test("(d) proxied ohne Basic-Auth -> 401", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({ tenants: [subscriberTenant("t_auth", "sub-a")] }),
  });
  try {
    const res = await retry(srv, { tenantId: "t_auth" }, { "X-Forwarded-For": "1.2.3.4" });
    assert.equal(res.status, 401);
  } finally {
    await srv.stop();
    await idp.close();
  }
});
