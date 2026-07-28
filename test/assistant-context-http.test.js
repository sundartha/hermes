// P3 (PLAN-PERSONAL-ASSISTANT): HTTP-Wiring + json-Persist von context ueber POST
// /api/calls. Reiner Spawn (startServer + Owner-Pfad), KEIN pglite in derselben Datei
// (Lehre p6a-Stall: NIE mischen). Beweist: (1) gueltiger Kontext erreicht den Originate
// und wird normalisiert persistiert; (2) Teilfeld-/Typ-Verstoesse -> 400 VOR der
// Telefonie; (3) unbekannte Keys fallen weg (Storage-Deckel); (4) Flag aus = context
// ignoriert (null). Der Owner heilt KYC beim Boot + traegt Nummer/Identitaet (helpers).
// I10 (call-quality Impl-1, HC7-HC9): die /api/calls-ERFOLGSantwort traegt additiv
// context_received (bool/count-Meta, nie der Inhalt); Erfolgspfad ueber den lokalen
// Telnyx-Voice-Mock (gleiches Muster wie onboarding-outbound.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

const TO = "+4915112345678"; // erlaubtes Ziel (steht in ALLOWED_NUMBERS), kein Premium/Notruf

// Voll besetzter, gueltiger Kontext (alle vier Teilfelder unter den Caps).
const CTX = {
  summary: "Stammkunde will Freitag vormittag",
  recipient_relationship: "Stammfriseur",
  desired_outcome: "Termin Freitag vormittag",
  key_facts: ["Name Mueller", "bevorzugt vormittags"],
};

const FLAG_ON = { ASSISTANT_CONTEXT_ENABLED: "true", ALLOWED_NUMBERS: TO };
// I12 drehte den config-DEFAULT auf true; BASE_ENV (helpers.js) pinnt das Flag in
// Spawn-Tests weiter EXPLIZIT auf "false" -> FLAG_OFF bleibt deterministisch aus.
const FLAG_OFF = { ALLOWED_NUMBERS: TO };

function placeCall(srv, body = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
}

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

test("HC1 Flag an, gueltiger context: erreicht den Originate (offline 500) + persistiert normalisierten context", async () => {
  const srv = await startServer({ env: FLAG_ON });
  try {
    const res = await placeCall(srv, { context: CTX });
    assert.equal(res.status, 500, "Owner passiert alle Gates, scheitert erst am Offline-Originate");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "genau ein Call erzeugt");
    assert.deepEqual(calls[0].context, CTX, "context normalisiert + json-persistiert");
  } finally {
    await srv.stop();
  }
});

test("HC2 Flag an, key_facts-Eintrag > 200 Zeichen -> 400 (Validierung vor Telefonie)", async () => {
  const srv = await startServer({ env: FLAG_ON });
  try {
    const res = await placeCall(srv, { context: { key_facts: ["a".repeat(201)] } });
    assert.equal(res.status, 400, "uebergrosser key_facts-Eintrag -> 400");
    assert.match((await res.json()).error, /key_facts/i);
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei 400");
  } finally {
    await srv.stop();
  }
});

test("AL-P9-9 Flag an, open_questions-Eintrag > 300 Zeichen -> 400 (Validierung vor Telefonie)", async () => {
  const srv = await startServer({ env: FLAG_ON });
  try {
    const res = await placeCall(srv, { context: { open_questions: ["a".repeat(301)] } });
    assert.equal(res.status, 400, "uebergrosser open_questions-Eintrag -> 400");
    assert.match((await res.json()).error, /open_questions/i);
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei 400");
  } finally {
    await srv.stop();
  }
});

test("HC3 Flag an, summary > 1000 Zeichen -> 400", async () => {
  const srv = await startServer({ env: FLAG_ON });
  try {
    const res = await placeCall(srv, { context: { summary: "a".repeat(1001) } });
    assert.equal(res.status, 400, "uebergrosse summary -> 400");
    assert.match((await res.json()).error, /summary/i);
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei 400");
  } finally {
    await srv.stop();
  }
});

test("HC4 Flag an, context kein Objekt -> 400 (context muss ein Objekt sein)", async () => {
  const srv = await startServer({ env: FLAG_ON });
  try {
    const res = await placeCall(srv, { context: "x" });
    assert.equal(res.status, 400, "Nicht-Objekt -> 400");
    assert.match((await res.json()).error, /context muss ein Objekt sein/i);
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei 400");
  } finally {
    await srv.stop();
  }
});

test("HC5 Flag an, unbekannter Key -> verworfen (Storage-Deckel), bekanntes Teilfeld bleibt", async () => {
  const srv = await startServer({ env: FLAG_ON });
  try {
    const res = await placeCall(srv, { context: { summary: "ok", junk: "x".repeat(5000) } });
    assert.equal(res.status, 500, "bekanntes Teilfeld gueltig -> Originate (offline 500)");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "ein Call erzeugt");
    assert.deepEqual(calls[0].context, { summary: "ok" }, "unbekannter Key verworfen, summary bleibt");
  } finally {
    await srv.stop();
  }
});

test("HC6 Flag AUS: b.context wird ignoriert -> context null (byte-identisch)", async () => {
  const srv = await startServer({ env: FLAG_OFF });
  try {
    const res = await placeCall(srv, { context: CTX });
    assert.equal(res.status, 500, "Owner-Pfad erreicht den Originate (offline 500)");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "ein Call erzeugt");
    assert.equal(calls[0].context, null, "Flag aus -> context ignoriert (null)");
  } finally {
    await srv.stop();
  }
});

// ---- I10 (call-quality Impl-1): context_received in der Erfolgsantwort ----
// Lokaler Mock der Telnyx-TeXML-Voice-API (Originate liefert {sid}) - der
// deterministische Weg zu einem 200 ohne echten Anruf (Muster onboarding-outbound).
async function startVoiceMock() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ sid: "tnx_ctx_mock_1" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const TELNYX_OWNER = { e164: "+13125550100", provider: "telnyx" };
const telnyxEnv = (mockUrl, extra = {}) => ({
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: mockUrl,
  ALLOWED_NUMBERS: TO,
  ...extra,
});

test("HC7 (I10) Flag an, voller context: Erfolgsantwort traegt context_received mit Feld-Flags + key_facts_count", async () => {
  const mock = await startVoiceMock();
  const srv = await startServer({
    env: telnyxEnv(mock.url, { ASSISTANT_CONTEXT_ENABLED: "true" }),
    ownerNumber: TELNYX_OWNER,
  });
  try {
    const res = await placeCall(srv, { context: CTX });
    assert.equal(res.status, 200, "Originate ueber den Voice-Mock erfolgreich");
    const json = await res.json();
    assert.deepEqual(
      json.context_received,
      {
        active: true,
        summary: true,
        key_facts_count: 2,
        recipient_relationship: true,
        desired_outcome: true,
      },
      "context_received meldet exakt die angekommenen Teilfelder (nur bool/count)",
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("HC8 (I10) Flag an, OHNE context: context_received meldet active, aber leere Felder", async () => {
  const mock = await startVoiceMock();
  const srv = await startServer({
    env: telnyxEnv(mock.url, { ASSISTANT_CONTEXT_ENABLED: "true" }),
    ownerNumber: TELNYX_OWNER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).context_received, {
      active: true,
      summary: false,
      key_facts_count: 0,
      recipient_relationship: false,
      desired_outcome: false,
    });
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("HC9 (I10) Flag AUS: context_received.active=false, alle Felder leer (context wurde ignoriert)", async () => {
  const mock = await startVoiceMock();
  const srv = await startServer({
    env: telnyxEnv(mock.url), // BASE_ENV pinnt ASSISTANT_CONTEXT_ENABLED=false
    ownerNumber: TELNYX_OWNER,
  });
  try {
    const res = await placeCall(srv, { context: CTX });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).context_received, {
      active: false,
      summary: false,
      key_facts_count: 0,
      recipient_relationship: false,
      desired_outcome: false,
    });
  } finally {
    await srv.stop();
    await mock.close();
  }
});
