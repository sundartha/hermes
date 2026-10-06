import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readBody, readJsonBody } from "../scripts/convo-bench/http-fake-helpers.mjs";
import { startExaFake } from "../scripts/convo-bench/exa-fake.mjs";

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
