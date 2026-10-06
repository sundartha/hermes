import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, externalIp, ROOT } from "./helpers.js";

const EXTERNAL_IP = externalIp();

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
  "WEB_DIST_DIR: Marketing OHNE Auth erreichbar, /api/state bleibt 403 (internalOnly)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({
      env: { WEB_DIST_DIR: WEB_DIST, DASHBOARD_PASSWORD: "test-geheim" },
    });
    try {
      const marketing = await fetch(`${srv.externalUrl}/`);
      assert.equal(marketing.status, 200, "Marketing-Landing ohne Auth erreichbar");
      assert.match(await marketing.text(), /Marketing-Fixture/);
      const api = await fetch(`${srv.externalUrl}/api/state`);
      assert.equal(api.status, 403, "API-Route weiter hinter internalOnly");
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

test("WEB_DIST_DIR: /app + Deep-Links liefern die App-Shell (SPA-Fallback)", async () => {
  const srv = await startServer({ env: { WEB_DIST_DIR: WEB_DIST } });
  try {
    const app = await fetch(`${srv.localUrl}/app`);
    assert.equal(app.status, 200, "App-Shell unter /app erreichbar");
    assert.match(await app.text(), /App-Fixture/);
    const deep = await fetch(`${srv.localUrl}/app/dashboard`);
    assert.equal(deep.status, 200, "Deep-Link liefert App-Shell (Client-Routing)");
    assert.match(await deep.text(), /App-Fixture/);
    const foo = await fetch(`${srv.localUrl}/app/foo`);
    assert.equal(foo.status, 200);
    const fooBody = await foo.text();
    assert.match(fooBody, /App-Fixture/);
    assert.doesNotMatch(fooBody, /Marketing-Fixture/);
  } finally {
    await srv.stop();
  }
});

test("WEB_DIST_DIR relativ: /app-Deep-Link liefert die App-Shell (sendFile absolut)", async () => {
  const relDist = path.relative(ROOT, WEB_DIST);
  const srv = await startServer({ env: { WEB_DIST_DIR: relDist } });
  try {
    const deep = await fetch(`${srv.localUrl}/app/foo`);
    assert.equal(deep.status, 200, "Deep-Link unter relativem WEB_DIST_DIR -> 200 (war 500)");
    assert.match(await deep.text(), /App-Fixture/);
  } finally {
    await srv.stop();
  }
});

test("WEB-03 (Mechanismus, gruen) - die App-Shell hinter dem /tenant.html-Redirect ist englisch", () => {
  const layout = fs.readFileSync(path.join(ROOT, "apps/web/src/layouts/App.astro"), "utf8");
  assert.match(layout, /<html lang="en">/, "App-Shell muss lang=en tragen");
  assert.doesNotMatch(layout, /<html lang="de">/, "App-Shell darf nicht hart deutsch sein");
});
