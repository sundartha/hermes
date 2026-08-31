// OC (PLAN-OWNER-CALL, PLAN-SECURITY.md Launch-Blocker geloest): Route-Ebene ueber
// POST /api/calls, Muster woertlich test/diagnostic-retention-http.test.js. Blocks D
// (Schalter+Besitz-Verifikation am Datensatz), E (Nicht-Leak) und F (diagnostic bleibt
// bei JEDEM Schalterstand unveraendert - die Zusage aus 2.2 "zwei Exporte, ein
// Vergleich" in Testform).
//
// Seit der Owner-Entscheidung 2026-08-21 ersetzt die Besitz-Verifikation
// (tenant.privateNumberVerifiedAt) die frueher hier per Env (OWNER_SELF_CALL_TENANT_IDS)
// gesteuerte Tenant-Allowlist - Block D seedet den Verifikationszustand deshalb direkt am
// Tenant-Record statt ihn ueber die Env zu pinnen (Muster voice-own-number-verify.test.js).
//
// FAKE_ORIGINATE=true legt NUR den TeXML-Zweig trocken (src/telephony/registry.js). Steht
// in der lokalen .env ELEVENLABS_OUTBOUND_ENABLED=true oder TELNYX_AI_ASSISTANT_ENABLED=
// true, verzweigt die Route VOR dem trockengelegten Zweig (api-calls.js:290 bzw. :304) -
// dann waere das ein ECHTER Anruf mit echten Kosten (Absolute Regel 1). BASE_ENV pinnt
// beide bereits auf "false"; hier stehen sie trotzdem ausdruecklich, weil dieser Test
// GENAU von ihnen abhaengt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { startServer, seedState } from "./helpers.js";

const OWN = "+491737252163";
const FOREIGN = "+491729999001";
// G25: kein Magic-Value - der einzige hier erwartete HTTP-Erfolgsstatus.
const HTTP_OK = 200;

function seedFor({ verified }) {
  return seedState({
    tenants: [
      {
        id: BOOTSTRAP_TENANT_ID,
        status: "active",
        firstName: "Jonas",
        ownerName: "Jonas Beispiel",
        privateNumber: OWN,
        ...(verified
          ? { privateNumberEmailConfirmedAt: "2026-08-01T00:00:00.000Z", privateNumberVerifiedAt: "2026-08-05T00:00:00.000Z" }
          : {}),
      },
    ],
  });
}

const BASE_CALL_ENV = {
  ALLOWED_COUNTRY_CODES: "+49",
  FAKE_ORIGINATE: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  TELNYX_AI_ASSISTANT_ENABLED: "false",
};

const postCall = (url, body) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objective: "Test", ...body }),
  });

async function callAndReadFlag({ env, verified, to }) {
  const srv = await startServer({ env: { ...BASE_CALL_ENV, ...env }, seed: seedFor({ verified }) });
  try {
    const res = await postCall(srv.localUrl, { to });
    assert.equal(res.status, HTTP_OK);
    const json = await res.json();
    const call = srv.readStore().calls.find((entry) => entry.id === json.callId);
    return { json, call, srv };
  } finally {
    await srv.stop();
  }
}

// ---- Block D: Schalter + Besitz-Verifikation am Anruf-Datensatz ----

test("OC-P1-60: Schalter an, Nummer besitz-verifiziert, Ziel = eigene Nummer -> calleeIsOwner true", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true" },
    verified: true,
    to: OWN,
  });
  assert.strictEqual(call.calleeIsOwner, true);
});

// S13-Beleg: das Praedikat MUSS auf ctx.to (normalisiert) lesen, nicht auf der rohen
// Eingabe. "01737252163" (nationale Schreibweise) loest ueber normalize_target
// (outbound-gates.js, Heimatland-Anker = privateNumber) auf "+491737252163" == OWN auf -
// GEMESSEN (nicht geraten): homeCountryCode(["+491737252163"], "DE") -> "+49",
// normalizeDialTarget("01737252163", "+49") -> "+491737252163".
test("OC-P1-60b: nationale Schreibweise der eigenen Nummer -> calleeIsOwner true (Beleg: Praedikat liest ctx.to)", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true" },
    verified: true,
    to: "01737252163",
  });
  assert.strictEqual(call.calleeIsOwner, true);
});

test("OC-P1-61: Schalter an, verifiziert, Ziel FREMD -> calleeIsOwner false", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true" },
    verified: true,
    to: FOREIGN,
  });
  assert.strictEqual(call.calleeIsOwner, false);
});

test("OC-P1-62: Schalter AUS, verifiziert, Ziel = eigene Nummer -> calleeIsOwner false", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "false" },
    verified: true,
    to: OWN,
  });
  assert.strictEqual(call.calleeIsOwner, false);
});

test("OC-P1-63: Schalter an, NICHT besitz-verifiziert, Ziel = eigene Nummer -> calleeIsOwner false (Nachfolger des Allowlist-leer-Falls)", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true" },
    verified: false,
    to: OWN,
  });
  assert.strictEqual(call.calleeIsOwner, false);
});

test("OC-P1-64: OWNER_SELF_CALL_TENANT_IDS ist wirkungslos - gesetzt, aber NICHT verifiziert -> calleeIsOwner bleibt false", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    verified: false,
    to: OWN,
  });
  assert.strictEqual(call.calleeIsOwner, false, "die alte Allowlist ersetzt die Besitz-Verifikation NICHT");
});

// ---- Block E: Nicht-Leak ----

// Die private Nummer erscheint auf DIESEM Call legitim und schon lange VOR OC-P1 als
// call.to (das Ziel, das der Aufrufer selbst gewaehlt hat) - das ist keine neue
// Leckstelle, sondern der Zweck des Calls. Der Beleg dieses Tests ist deshalb NICHT
// "die Nummer taucht nirgends auf", sondern: ausserhalb von call.to/call.from (den
// beiden Feldern, die JEDER Call schon immer traegt) erscheint sie NIRGENDS NEU -
// insbesondere nicht als eigenes Tenant-/Agent-Feld. Nur das neue Boolean
// (calleeIsOwner) ist neu am Datensatz.
test("OC-P1-65: GET /api/state traegt calleeIsOwner:true, die private Nummer NIRGENDS NEU (nur legitim als call.to)", async () => {
  const srv = await startServer({
    env: { ...BASE_CALL_ENV, OWNER_SELF_CALL_ENABLED: "true" },
    seed: seedFor({ verified: true }),
  });
  try {
    const placed = await postCall(srv.localUrl, { to: OWN });
    assert.equal(placed.status, HTTP_OK);
    const { callId } = await placed.json();

    const stateRes = await fetch(`${srv.localUrl}/api/state`);
    assert.equal(stateRes.status, HTTP_OK);
    const stateJson = await stateRes.json();

    const call = stateJson.calls.find((entry) => entry.id === callId);
    assert.strictEqual(call.calleeIsOwner, true, "das Boolean erscheint - gewollt (publicCall-Denylist)");
    assert.equal(call.to, OWN, "call.to traegt die Nummer LEGITIM (das gewaehlte Ziel)");

    // Denselben Datensatz OHNE die zwei legitimen Felder serialisieren - danach darf die
    // Nummer in der GESAMTEN Antwort (alle Calls, agent, settings, ...) nicht mehr stehen.
    const sanitizedCalls = stateJson.calls.map(({ to: _to, from: _from, ...rest }) => rest);
    const sanitized = JSON.stringify({ ...stateJson, calls: sanitizedCalls });
    assert.ok(!sanitized.includes(OWN), "ausserhalb von call.to/call.from erscheint die Nummer nirgends neu");
    assert.ok(
      !JSON.stringify(stateJson.agent).includes(OWN),
      "agent.number ist die aktive DID, NICHT die private Nummer",
    );
  } finally {
    await srv.stop();
  }
});

// ---- Block F: diagnostic unveraendert bei JEDEM Schalterstand (2.2, zwei Exporte, ein Vergleich) ----

async function diagnosticFor({ env, verified, to }) {
  const srv = await startServer({
    env: { ...BASE_CALL_ENV, DIAGNOSTIC_RETENTION_DAYS: "7", ...env },
    seed: seedFor({ verified }),
  });
  try {
    const res = await postCall(srv.localUrl, { to });
    assert.equal(res.status, HTTP_OK);
    const json = await res.json();
    const call = srv.readStore().calls.find((entry) => entry.id === json.callId);
    return call;
  } finally {
    await srv.stop();
  }
}

test("OC-P1-67: OWNER_SELF_CALL_ENABLED=false, Ziel eigene Nummer -> diagnostic weiterhin true", async () => {
  const call = await diagnosticFor({ env: { OWNER_SELF_CALL_ENABLED: "false" }, verified: false, to: OWN });
  assert.strictEqual(call.diagnostic, true);
});

test("OC-P1-68: OWNER_SELF_CALL_ENABLED=true + verifiziert, Ziel eigene Nummer -> diagnostic identisch true", async () => {
  const call = await diagnosticFor({ env: { OWNER_SELF_CALL_ENABLED: "true" }, verified: true, to: OWN });
  assert.strictEqual(call.diagnostic, true);
});

test("OC-P1-69: OWNER_SELF_CALL_ENABLED=true + NICHT verifiziert, Ziel eigene Nummer -> diagnostic true, calleeIsOwner false (zwei Exporte, ein Vergleich)", async () => {
  const call = await diagnosticFor({ env: { OWNER_SELF_CALL_ENABLED: "true" }, verified: false, to: OWN });
  assert.strictEqual(call.diagnostic, true, "Diagnose-Retention haengt NICHT an der Besitz-Verifikation");
  assert.strictEqual(call.calleeIsOwner, false, "die Offenlegungs-Ausnahme haengt SEHR WOHL an der Besitz-Verifikation");
});
