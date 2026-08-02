// AL-D3 Review-Fix (Runde 1, G5/S2): readBody/readJsonBody wurden aus
// scripts/convo-bench/telnyx-fake.mjs und scripts/convo-bench/exa-fake.mjs in
// scripts/convo-bench/http-fake-helpers.mjs gezogen, um die Byte-fuer-Byte-Kopie
// zwischen den beiden Fakes zu beenden. Dieser Test deckt die extrahierte Funktion
// direkt ab (Verhalten: Body sammeln, JSON tolerant parsen) und faengt eine
// Regression aus dem Zusammenzug (Vorlage test/al-p8-bench-shim-driver.test.js).
//
// Testname-Praefix "AL-D3-" trifft KEIN Katalog-Praefix aus package.json
// config.i18nCatalogPattern - dieser Test laeuft in `npm test`, wo Rot zaehlt.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readBody, readJsonBody } from "../scripts/convo-bench/http-fake-helpers.mjs";
import { startTelnyxFake, callControlEventBody } from "../scripts/convo-bench/telnyx-fake.mjs";
import { startExaFake } from "../scripts/convo-bench/exa-fake.mjs";

// Minimaler lokaler Server, der jeden eingehenden Request an die uebergebene
// Handler-Funktion durchreicht - Vorlage fuer readBody/readJsonBody direkt gegen
// einen echten node:http.IncomingMessage zu pruefen (kein Mock des req-Objekts).
async function withEchoServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("AL-D3-N1: readBody liefert den rohen Request-Body als String", async () => {
  let captured;
  const srv = await withEchoServer(async (req, res) => {
    captured = await readBody(req);
    res.writeHead(200);
    res.end();
  });
  try {
    await fetch(srv.url, { method: "POST", body: "hallo welt" });
    assert.equal(captured, "hallo welt");
  } finally {
    await srv.close();
  }
});

test("AL-D3-N2: readJsonBody parst gueltiges JSON", async () => {
  let captured;
  const srv = await withEchoServer(async (req, res) => {
    captured = await readJsonBody(req);
    res.writeHead(200);
    res.end();
  });
  try {
    await fetch(srv.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    assert.deepEqual(captured, { foo: "bar" });
  } finally {
    await srv.close();
  }
});

test("AL-D3-N3: readJsonBody faellt bei leerem oder kaputtem Body auf {} zurueck, statt zu werfen", async () => {
  const captured = [];
  const srv = await withEchoServer(async (req, res) => {
    captured.push(await readJsonBody(req));
    res.writeHead(200);
    res.end();
  });
  try {
    await fetch(srv.url, { method: "POST", body: "" });
    await fetch(srv.url, { method: "POST", body: "{nicht json" });
    assert.deepEqual(captured, [{}, {}]);
  } finally {
    await srv.close();
  }
});

test("AL-D3-N4: telnyx-fake liest Action-Bodies weiterhin ueber die geteilte Funktion", async () => {
  const fake = await startTelnyxFake();
  try {
    const callControlId = "call-123";
    await fetch(`${fake.url}/v2/calls/${callControlId}/actions/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "hallo" }),
    });
    const hit = await fake.waitForAction({ callControlId, action: "speak" });
    assert.deepEqual(hit.body, { payload: "hallo" });
    // Ereignis-Huelle bleibt unveraendert (kein Scope-Drift in callControlEventBody).
    const event = callControlEventBody({ eventType: "call.speak.ended", callControlId, status: "completed" });
    assert.equal(event.data.event_type, "call.speak.ended");
  } finally {
    await fake.close();
  }
});

test("AL-D3-N5: exa-fake liest Such-Requests weiterhin ueber die geteilte Funktion", async () => {
  const fake = await startExaFake({ facts: [{ title: "Treffer", highlight: "Auszug" }] });
  try {
    const res = await fetch(`${fake.url}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "wetter morgen" }),
    });
    const json = await res.json();
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].title, "Treffer");
    assert.deepEqual(fake.requests()[0].body, { query: "wetter morgen" });
  } finally {
    await fake.close();
  }
});
