import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

const HTTP_OK = 200;
const ANRUFE = 10;
const SCHLEIFE = "127.0.0.1";

async function mitZaehlServer(lauf) {
  const sockets = new Set();
  const gesehen = [];
  const server = http.createServer((req, res) => {
    gesehen.push({ host: req.headers.host, verbindung: req.headers.connection });
    req.resume();
    req.on("end", () => {
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ callId: `c${gesehen.length}` }));
    });
  });
  server.on("connection", (socket) => sockets.add(socket));
  await new Promise((resolve) => server.listen(0, SCHLEIFE, resolve));
  try {
    return await lauf({ port: server.address().port, sockets, gesehen });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function ladeHilfe() {
  const modul = await import("../gemeinsam/abruf-ohne-pool.mjs");
  return modul.abrufOhnePool;
}

test("el-outbound-verbindung-stabil: zehn Anrufe nacheinander bekommen je 200 mit callId", async () => {
  const abrufOhnePool = await ladeHilfe();
  await mitZaehlServer(async ({ port }) => {
    for (let i = 0; i < ANRUFE; i++) {
      const res = await abrufOhnePool(`http://localhost:${port}/api/calls`, {
        method: "POST",
        body: "{}",
      });
      assert.equal(res.status, HTTP_OK);
      assert.match((await res.json()).callId, /^c\d+$/);
    }
  });
});

test("el-outbound-verbindung-stabil: jeder Aufruf baut eine frische Verbindung auf", async () => {
  const abrufOhnePool = await ladeHilfe();
  await mitZaehlServer(async ({ port, sockets, gesehen }) => {
    for (let i = 0; i < ANRUFE; i++) {
      await (await abrufOhnePool(`http://${SCHLEIFE}:${port}/x`)).text();
    }
    assert.equal(sockets.size, ANRUFE);
    assert.deepEqual(new Set(gesehen.map((g) => g.verbindung)), new Set(["close"]));
  });
});

test("el-outbound-verbindung-stabil: localhost wird zur Schleifenadresse des Test-Hermes", async () => {
  const abrufOhnePool = await ladeHilfe();
  await mitZaehlServer(async ({ port, gesehen }) => {
    await (await abrufOhnePool(`http://localhost:${port}/x`)).text();
    assert.equal(gesehen[0].host, `${SCHLEIFE}:${port}`);
  });
});
