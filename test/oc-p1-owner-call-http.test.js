// OC-P1 (PLAN-OWNER-CALL): Route-Ebene ueber POST /api/calls, Muster woertlich
// test/diagnostic-retention-http.test.js. Blocks D (Schalter+Allowlist am Datensatz),
// E (Nicht-Leak) und F (diagnostic bleibt bei JEDEM Schalterstand unveraendert - die
// Zusage aus 2.2 "zwei Exporte, ein Vergleich" in Testform).
//
// FAKE_ORIGINATE=true legt NUR den TeXML-Zweig trocken (src/telephony/registry.js). Steht
// in der lokalen .env ELEVENLABS_OUTBOUND_ENABLED=true, verzweigt die Route VOR dem
// trockengelegten Zweig - dann waere das ein ECHTER Anruf mit echten Kosten (Absolute
// Regel 1). BASE_ENV pinnt das bereits auf "false"; hier steht es trotzdem ausdruecklich,
// weil dieser Test GENAU davon abhaengt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { startServer, seedState } from "./helpers.js";

const OWN = "+491737252163";
const FOREIGN = "+491729999001";
const OTHER_TENANT = "t_fremd";
// G25: kein Magic-Value - der einzige hier erwartete HTTP-Erfolgsstatus.
const HTTP_OK = 200;

const seed = seedState({
  tenants: [
    {
      id: BOOTSTRAP_TENANT_ID,
      status: "active",
      firstName: "Jonas",
      ownerName: "Jonas Beispiel",
      privateNumber: OWN,
    },
  ],
});

const BASE_CALL_ENV = {
  ALLOWED_COUNTRY_CODES: "+49",
  FAKE_ORIGINATE: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
};

const postCall = (url, body) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objective: "Test", ...body }),
  });

async function callAndReadFlag({ env, to }) {
  const srv = await startServer({ env: { ...BASE_CALL_ENV, ...env }, seed });
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

// ---- Block D: Schalter + Allowlist am Anruf-Datensatz ----

test("OC-P1-60: Schalter an, Tenant gepinnt, Ziel = eigene Nummer -> calleeIsOwner true", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
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
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    to: "01737252163",
  });
  assert.strictEqual(call.calleeIsOwner, true);
});

test("OC-P1-61: Schalter an, Tenant gepinnt, Ziel FREMD -> calleeIsOwner false", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    to: FOREIGN,
  });
  assert.strictEqual(call.calleeIsOwner, false);
});

test("OC-P1-62: Schalter AUS, Tenant gepinnt, Ziel = eigene Nummer -> calleeIsOwner false", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "false", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    to: OWN,
  });
  assert.strictEqual(call.calleeIsOwner, false);
});

test("OC-P1-63: Schalter an, Allowlist LEER, Ziel = eigene Nummer -> calleeIsOwner false", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: "" },
    to: OWN,
  });
  assert.strictEqual(call.calleeIsOwner, false);
});

test("OC-P1-64: Schalter an, Allowlist ohne diesen Tenant, Ziel = eigene Nummer -> calleeIsOwner false", async () => {
  const { call } = await callAndReadFlag({
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: OTHER_TENANT },
    to: OWN,
  });
  assert.strictEqual(call.calleeIsOwner, false);
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
    env: {
      ...BASE_CALL_ENV,
      OWNER_SELF_CALL_ENABLED: "true",
      OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID,
    },
    seed,
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

async function diagnosticFor({ env, to }) {
  const srv = await startServer({
    env: { ...BASE_CALL_ENV, DIAGNOSTIC_RETENTION_DAYS: "7", ...env },
    seed,
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
  const call = await diagnosticFor({
    env: { OWNER_SELF_CALL_ENABLED: "false", OWNER_SELF_CALL_TENANT_IDS: "" },
    to: OWN,
  });
  assert.strictEqual(call.diagnostic, true);
});

test("OC-P1-68: OWNER_SELF_CALL_ENABLED=true + Tenant gepinnt, Ziel eigene Nummer -> diagnostic identisch true", async () => {
  const call = await diagnosticFor({
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    to: OWN,
  });
  assert.strictEqual(call.diagnostic, true);
});

test("OC-P1-69: OWNER_SELF_CALL_ENABLED=true + Allowlist LEER, Ziel eigene Nummer -> diagnostic true, calleeIsOwner false (zwei Exporte, ein Vergleich)", async () => {
  const call = await diagnosticFor({
    env: { OWNER_SELF_CALL_ENABLED: "true", OWNER_SELF_CALL_TENANT_IDS: "" },
    to: OWN,
  });
  assert.strictEqual(call.diagnostic, true, "Diagnose-Retention haengt NICHT an der Allowlist");
  assert.strictEqual(call.calleeIsOwner, false, "die Offenlegungs-Ausnahme haengt SEHR WOHL an der Allowlist");
});
