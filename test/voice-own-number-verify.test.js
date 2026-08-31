// OC-Besitz-Verifikation, Stufe 2 (PLAN-SECURITY.md Launch-Blocker geloest, Owner-
// Entscheidung 2026-08-21): der Besitznachweis per Anruf ueber die reale HTTP-Route
// POST /voice/incoming (routes/voice.js), NACH der Tenant-Aufloesung und VOR store.createCall.
// Spawn-Server (F.I.R.S.T. bleibt gewahrt: kein echtes Netz, SKIP_TWILIO_SIGNATURE_CHECK).
// Muster oc-p1-owner-call-http.test.js (Spawn statt pglite, weil die Route provider-
// dispatch-gebunden ist).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  startServer,
  seedState,
  postTelnyxIncoming,
  TELNYX_TEST_PEER_NUMBER,
  TELNYX_TEST_TENANT_NUMBER,
} from "./helpers.js";

// G25: kein Magic-Value - der einzige hier erwartete HTTP-Erfolgsstatus.
const HTTP_OK = 200;

function seedFor({ privateNumber, emailConfirmedAt, verifiedAt } = {}) {
  return seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        ownerName: "Jonas Beispiel",
        firstName: "Jonas",
        ...(privateNumber ? { privateNumber } : {}),
        ...(emailConfirmedAt ? { privateNumberEmailConfirmedAt: emailConfirmedAt } : {}),
        ...(verifiedAt ? { privateNumberVerifiedAt: verifiedAt } : {}),
      },
    ],
    numbers: [
      {
        id: "num_telnyx",
        e164: TELNYX_TEST_TENANT_NUMBER,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
      },
    ],
  });
}

test("OC-Stufe2-01: From == bestaetigte eigene Nummer -> privateNumberVerifiedAt gesetzt, Audit-Zeile, Gespraechsfluss unveraendert (TeXML 200)", async () => {
  const seed = seedFor({ privateNumber: TELNYX_TEST_PEER_NUMBER, emailConfirmedAt: "2026-08-01T00:00:00.000Z" });
  const srv = await startServer({ seed });
  try {
    const res = await postTelnyxIncoming(srv);
    assert.equal(res.status, HTTP_OK);
    const xml = await res.text();
    assert.match(xml, /<Response>/, "TeXML-Antwort unveraendert - kein anderer Zweig");

    const tenant = srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
    assert.ok(tenant.privateNumberVerifiedAt, "Stufe 2 abgeschlossen");
    assert.match(srv.stdout, /\[audit\] own_number_verified .*tenant=owner/);
  } finally {
    await srv.stop();
  }
});

test("OC-Stufe2-02: From != eigene Nummer -> keine Mutation, kein Verify-Audit", async () => {
  const seed = seedFor({ privateNumber: "+491729999001", emailConfirmedAt: "2026-08-01T00:00:00.000Z" });
  const srv = await startServer({ seed });
  try {
    const res = await postTelnyxIncoming(srv); // From = TELNYX_TEST_PEER_NUMBER, != hinterlegte Nummer
    assert.equal(res.status, HTTP_OK);
    const tenant = srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
    assert.equal(tenant.privateNumberVerifiedAt, undefined);
    assert.doesNotMatch(srv.stdout, /\[audit\] own_number_verified ip/);
  } finally {
    await srv.stop();
  }
});

test("OC-Stufe2-03: Match VOR abgeschlossener E-Mail-Bestaetigung -> keine Mutation, Support-Audit-Hinweis", async () => {
  const seed = seedFor({ privateNumber: TELNYX_TEST_PEER_NUMBER }); // Stufe 1 NICHT durchlaufen
  const srv = await startServer({ seed });
  try {
    const res = await postTelnyxIncoming(srv);
    assert.equal(res.status, HTTP_OK);
    const tenant = srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
    assert.equal(tenant.privateNumberVerifiedAt, undefined, "Reihenfolge Stufe 1 vor Stufe 2 ist Pflicht");
    assert.match(
      srv.stdout,
      /\[audit\] own_number_verify_skipped .*tenant=owner reason=call_match_before_email_confirm/,
    );
  } finally {
    await srv.stop();
  }
});

test("OC-Stufe2-04: keine hinterlegte Nummer -> keine Mutation, kein Absturz", async () => {
  const seed = seedFor();
  const srv = await startServer({ seed });
  try {
    const res = await postTelnyxIncoming(srv);
    assert.equal(res.status, HTTP_OK);
    const tenant = srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
    assert.equal(tenant.privateNumberVerifiedAt, undefined);
  } finally {
    await srv.stop();
  }
});

test("OC-Stufe2-05: bereits verifiziert -> zweiter Anruf mutiert nichts mehr (Einmalverwendung)", async () => {
  const seed = seedFor({
    privateNumber: TELNYX_TEST_PEER_NUMBER,
    emailConfirmedAt: "2026-08-01T00:00:00.000Z",
    verifiedAt: "2026-08-05T00:00:00.000Z",
  });
  const srv = await startServer({ seed });
  try {
    const res = await postTelnyxIncoming(srv);
    assert.equal(res.status, HTTP_OK);
    const tenant = srv.readStore().tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
    assert.equal(tenant.privateNumberVerifiedAt, "2026-08-05T00:00:00.000Z", "unveraendert - kein neuer Zeitstempel");
  } finally {
    await srv.stop();
  }
});
