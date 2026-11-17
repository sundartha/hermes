import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteAbbrechendeAttrappe, starteErfolgreicheAttrappe } from "./vorspann-fahrzeug.js";

const TO = "+4915112345678";
const abbrechend = await starteAbbrechendeAttrappe("kontext", [BOOTSTRAP_TENANT_ID]);
const erfolgreich = await starteErfolgreicheAttrappe("kontext-ok", [BOOTSTRAP_TENANT_ID]);
after(() => Promise.all([abbrechend.close(), erfolgreich.close()]));

const CTX = {
  summary: "Stammkunde will Freitag vormittag",
  recipient_relationship: "Stammfriseur",
  desired_outcome: "Termin Freitag vormittag",
  key_facts: ["Name Mueller", "bevorzugt vormittags"],
};

const FLAG_ON = { ASSISTANT_CONTEXT_ENABLED: "true", ALLOWED_NUMBERS: TO };
const FLAG_OFF = { ALLOWED_NUMBERS: TO };

function placeCall(srv, body = {}) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
}

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

test("HC1 Flag an, gueltiger context: erreicht den Originate (offline 500) + persistiert normalisierten context", async () => {
  const srv = await startServer({ env: { ...abbrechend.env, ...FLAG_ON } });
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
  const srv = await startServer({ env: { ...abbrechend.env, ...FLAG_ON } });
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
  const srv = await startServer({ env: { ...abbrechend.env, ...FLAG_ON } });
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
  const srv = await startServer({ env: { ...abbrechend.env, ...FLAG_ON } });
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
  const srv = await startServer({ env: { ...abbrechend.env, ...FLAG_ON } });
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
  const srv = await startServer({ env: { ...abbrechend.env, ...FLAG_ON } });
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
  const srv = await startServer({ env: { ...abbrechend.env, ...FLAG_OFF } });
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

test("HC7 (I10) Flag an, voller context: Erfolgsantwort traegt context_received mit Feld-Flags + key_facts_count", async () => {
  const srv = await startServer({ env: { ...erfolgreich.env, ASSISTANT_CONTEXT_ENABLED: "true" } });
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
  }
});

test("HC8 (I10) Flag an, OHNE context: context_received meldet active, aber leere Felder", async () => {
  const srv = await startServer({ env: { ...erfolgreich.env, ASSISTANT_CONTEXT_ENABLED: "true" } });
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
  }
});

test("HC9 (I10) Flag AUS: context_received.active=false, alle Felder leer (context wurde ignoriert)", async () => {
  const srv = await startServer({ env: erfolgreich.env });
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
  }
});
