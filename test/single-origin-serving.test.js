// P1 — Single-Origin-Serving: WEB_DIST_DIR liefert den apps/web-Build statisch VOR der
// Basic-Auth. Spawn-Tests (startServer) gegen ein winziges Fixture-dist. Beweist:
//  (1) Marketing-Pfad ist OHNE Auth erreichbar (static vor Basic-Auth), die Owner-Legacy-
//      API (/api/calls) bleibt HINTER der Basic-Auth (401 - kein Freilegen).
//  (2) /tenant.html -> 302 /app (Owner-Removal-Altpfad, Bookmarks).
// KEIN pglite hier (nur Server-Spawn, Lehre P6a). node:http-GET ohne Redirect-Follow.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, externalIp } from "./helpers.js";

const EXTERNAL_IP = externalIp();

// Winziges Fixture-dist (= apps/web/dist im Echtbetrieb): Marketing-index.html +
// app/index.html (App-Shell). Einmal angelegt, am Dateiende geloescht. WEB_DIST_DIR
// zeigt darauf -> der Boot-Guard (config.js) findet index.html und bootet.
const WEB_DIST = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-webdist-"));
fs.writeFileSync(
  path.join(WEB_DIST, "index.html"),
  "<!doctype html><title>Marketing-Fixture</title>",
);
fs.mkdirSync(path.join(WEB_DIST, "app"));
fs.writeFileSync(
  path.join(WEB_DIST, "app", "index.html"),
  "<!doctype html><title>App-Fixture</title>",
);
after(() => fs.rmSync(WEB_DIST, { recursive: true, force: true }));

// Roher GET ohne Redirect-Follow (node:http folgt 3xx nicht) -> {status, location}.
// path traegt pathname + search, damit der Query-erhaltende /tenant.html-Redirect
// (P2/D2) pruefbar ist.
function rawGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET" },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test(
  "WEB_DIST_DIR: Marketing OHNE Auth erreichbar (static VOR Basic-Auth), /api/calls bleibt 401",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    // DASHBOARD_PASSWORD gesetzt -> Basic-Auth scharf; extern (keine localhost-Ausnahme).
    const srv = await startServer({
      env: { WEB_DIST_DIR: WEB_DIST, DASHBOARD_PASSWORD: "test-geheim" },
    });
    try {
      // Marketing-Landing same-origin OHNE Credentials -> 200 (static greift vor Basic-Auth).
      const marketing = await fetch(`${srv.externalUrl}/`);
      assert.equal(marketing.status, 200, "Marketing-Landing ohne Auth erreichbar");
      assert.match(await marketing.text(), /Marketing-Fixture/);
      // Negativ: die Owner-Legacy-API bleibt HINTER der Basic-Auth (kein Freilegen).
      const api = await fetch(`${srv.externalUrl}/api/calls`);
      assert.equal(api.status, 401, "Owner-Legacy-API weiter hinter Basic-Auth");
    } finally {
      await srv.stop();
    }
  },
);

test("WEB_DIST_DIR: /tenant.html -> 302 /app (Altpfad-Redirect, Bookmarks)", async () => {
  const srv = await startServer({ env: { WEB_DIST_DIR: WEB_DIST } });
  try {
    const res = await rawGet(`${srv.localUrl}/tenant.html`);
    assert.equal(res.status, 302);
    assert.equal(res.location, "/app");
  } finally {
    await srv.stop();
  }
});

// P2/D2: der Query-String muss den Redirect ueberleben, sonst geht die Post-Checkout-
// Rueckkehr (?sub=ok / ?card=ok) auf dem Weg /tenant.html -> /app verloren und die
// BillingIsland zeigt die Rueckmeldung nie an.
test("WEB_DIST_DIR: /tenant.html?sub=ok -> 302 /app?sub=ok (Query erhalten)", async () => {
  const srv = await startServer({ env: { WEB_DIST_DIR: WEB_DIST } });
  try {
    const res = await rawGet(`${srv.localUrl}/tenant.html?sub=ok`);
    assert.equal(res.status, 302);
    assert.equal(res.location, "/app?sub=ok");
    const card = await rawGet(`${srv.localUrl}/tenant.html?card=ok`);
    assert.equal(card.location, "/app?card=ok");
  } finally {
    await srv.stop();
  }
});

// Kernziel Single-Origin: Post-Login-Ziel /app + clientseitiges Routing. fetch folgt
// dem serve-static-301 (/app -> /app/) automatisch -> wir pruefen das End-Ergebnis.
test("WEB_DIST_DIR: /app + Deep-Links liefern die App-Shell (SPA-Fallback)", async () => {
  const srv = await startServer({ env: { WEB_DIST_DIR: WEB_DIST } });
  try {
    // /app -> express.static-Index (serve-static 301 -> /app/ -> app/index.html).
    const app = await fetch(`${srv.localUrl}/app`);
    assert.equal(app.status, 200, "App-Shell unter /app erreichbar");
    assert.match(await app.text(), /App-Fixture/);
    // Deep-Link: kein Datei-Treffer -> SPA-Fallback app.get("/app/*") liefert die Shell.
    const deep = await fetch(`${srv.localUrl}/app/dashboard`);
    assert.equal(deep.status, 200, "Deep-Link liefert App-Shell (Client-Routing)");
    assert.match(await deep.text(), /App-Fixture/);
    // Negativ: ein /app-Unterpfad serviert NIE die Marketing-index (kein Shadowing).
    const foo = await fetch(`${srv.localUrl}/app/foo`);
    assert.equal(foo.status, 200);
    const fooBody = await foo.text();
    assert.match(fooBody, /App-Fixture/);
    assert.doesNotMatch(fooBody, /Marketing-Fixture/);
  } finally {
    await srv.stop();
  }
});
