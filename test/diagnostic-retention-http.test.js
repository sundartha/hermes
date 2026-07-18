// P2b (PLAN-CONVERSATION-QUALITY-V2): der Scope-Beweis MUSS serverseitig liegen (der
// Wunsch des Aufrufers ist keine Wahrheit). Muster wie dial-target-normalization.test.js
// Sektion 2: ein Owner-Tenant mit gesetzter privateNumber (OWN), FAKE_ORIGINATE=true fuer
// einen synthetischen 200-Erfolg ohne echten Provider-Call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { startServer, seedState } from "./helpers.js";

const OWN = "+491737252163";
const FOREIGN = "+491729999001";

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

const postCall = (url, body) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objective: "Test", ...body }),
  });

test("P2b-40: to=eigene Nummer + diagnostic=true -> gewaehrt (Response UND Store)", async () => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+49", FAKE_ORIGINATE: "true", DIAGNOSTIC_RETENTION_DAYS: "7" },
    seed,
  });
  try {
    const res = await postCall(srv.localUrl, { to: OWN, diagnostic: true });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.diagnostic, true);
    const call = srv.readStore().calls.find((c) => c.id === json.callId);
    assert.equal(call.diagnostic, true);
  } finally {
    await srv.stop();
  }
});

test("P2b-41 (Scope-Beweis): to=fremde Nummer + diagnostic=true -> still verworfen", async () => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+49", FAKE_ORIGINATE: "true", DIAGNOSTIC_RETENTION_DAYS: "7" },
    seed,
  });
  try {
    const res = await postCall(srv.localUrl, { to: FOREIGN, diagnostic: true });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.diagnostic, false);
    const call = srv.readStore().calls.find((c) => c.id === json.callId);
    assert.equal(call.diagnostic, false);
  } finally {
    await srv.stop();
  }
});

test("P2b-42: to=eigene Nummer OHNE diagnostic-Feld -> Default false (Bestandsverhalten)", async () => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+49", FAKE_ORIGINATE: "true", DIAGNOSTIC_RETENTION_DAYS: "7" },
    seed,
  });
  try {
    const res = await postCall(srv.localUrl, { to: OWN });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.diagnostic, false);
  } finally {
    await srv.stop();
  }
});

test("P2b-43: DIAGNOSTIC_RETENTION_DAYS=0 -> Feature-Aus wirkt am Producer (kein Grant trotz Scope-Treffer)", async () => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+49", FAKE_ORIGINATE: "true", DIAGNOSTIC_RETENTION_DAYS: "0" },
    seed,
  });
  try {
    const res = await postCall(srv.localUrl, { to: OWN, diagnostic: true });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.diagnostic, false);
  } finally {
    await srv.stop();
  }
});
