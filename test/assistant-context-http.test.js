// P3 (PLAN-PERSONAL-ASSISTANT): HTTP-Wiring + json-Persist von context ueber POST
// /api/calls. Reiner Spawn (startServer + Owner-Pfad), KEIN pglite in derselben Datei
// (Lehre p6a-Stall: NIE mischen). Beweist: (1) gueltiger Kontext erreicht den Originate
// und wird normalisiert persistiert; (2) Teilfeld-/Typ-Verstoesse -> 400 VOR der
// Telefonie; (3) unbekannte Keys fallen weg (Storage-Deckel); (4) Flag aus = context
// ignoriert (null). Der Owner heilt KYC beim Boot + traegt Nummer/Identitaet (helpers).
import test from "node:test";
import assert from "node:assert/strict";
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
const FLAG_OFF = { ALLOWED_NUMBERS: TO }; // ASSISTANT_CONTEXT_ENABLED default false

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
