import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const TO = "+4915112345678";

const MANDATE = {
  decide_freely: "Termin an einem Werktag zwischen 9 und 12 Uhr, bis 60 Euro",
  fallback_order: "zuerst Donnerstag, sonst Freitag",
  on_out_of_scope: "take_message",
};

function placeCall(srv, body = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
}

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

test("HM1 gueltiges Mandat: erreicht den Originate (offline 500) + persistiert normalisiertes mandate", async () => {
  const srv = await startServer();
  try {
    const res = await placeCall(srv, { mandate: MANDATE });
    assert.equal(res.status, 500, "Owner passiert alle Gates, scheitert erst am Offline-Originate");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "genau ein Call erzeugt");
    assert.deepEqual(calls[0].mandate, MANDATE, "mandate normalisiert + json-persistiert");
  } finally {
    await srv.stop();
  }
});

test("HM2 on_out_of_scope mit unbekanntem Wert -> 400, Fehlertext nennt on_out_of_scope, kein Call", async () => {
  const srv = await startServer();
  try {
    const res = await placeCall(srv, { mandate: { on_out_of_scope: "nope" } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /on_out_of_scope/i);
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei 400");
  } finally {
    await srv.stop();
  }
});

test("HM3 decide_freely > 1000 Zeichen -> 400, kein Call", async () => {
  const srv = await startServer();
  try {
    const res = await placeCall(srv, { mandate: { decide_freely: "a".repeat(1001) } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /decide_freely/i);
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei 400");
  } finally {
    await srv.stop();
  }
});

test("HM4 mandate als Nicht-Objekt -> 400 (mandate muss ein Objekt sein)", async () => {
  const srv = await startServer();
  try {
    const res = await placeCall(srv, { mandate: "text" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /mandate muss ein Objekt sein/i);
    assert.equal(outboundCallsTo(srv).length, 0, "kein Call bei 400");
  } finally {
    await srv.stop();
  }
});

test("HM5 unbekannte Sub-Keys fallen weg (Storage-Deckel), bekanntes Teilfeld bleibt", async () => {
  const srv = await startServer();
  try {
    const res = await placeCall(srv, { mandate: { decide_freely: "x", hack: "y" } });
    assert.equal(res.status, 500, "bekanntes Teilfeld gueltig -> Originate (offline 500)");
    const calls = outboundCallsTo(srv);
    assert.equal(calls.length, 1, "ein Call erzeugt");
    assert.deepEqual(
      calls[0].mandate,
      { decide_freely: "x" },
      "unbekannter Key verworfen, decide_freely bleibt",
    );
  } finally {
    await srv.stop();
  }
});
