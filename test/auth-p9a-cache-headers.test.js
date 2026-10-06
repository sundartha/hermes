import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./helpers.js";

const HTTP_OK = 200;

const WEB_DIST = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-webdist-p9a-"));
fs.writeFileSync(
  path.join(WEB_DIST, "index.html"),
  "<!doctype html><title>Marketing-Fixture</title>",
);
fs.mkdirSync(path.join(WEB_DIST, "app"));
fs.writeFileSync(
  path.join(WEB_DIST, "app", "index.html"),
  "<!doctype html><title>App-Fixture</title>",
);
fs.mkdirSync(path.join(WEB_DIST, "_astro"));
fs.writeFileSync(path.join(WEB_DIST, "_astro", "chunk.AbC12345.js"), "console.log('chunk');");
fs.mkdirSync(path.join(WEB_DIST, "_astrophysik"));
fs.writeFileSync(path.join(WEB_DIST, "_astrophysik", "hinweis.js"), "console.log('kein chunk');");
fs.mkdirSync(path.join(WEB_DIST, "assets"));
fs.writeFileSync(path.join(WEB_DIST, "assets", "hero.js"), "console.log('hero');");

let srv;
before(async () => {
  srv = await startServer({ env: { WEB_DIST_DIR: WEB_DIST } });
});
after(async () => {
  await srv?.stop();
  fs.rmSync(WEB_DIST, { recursive: true, force: true });
});

test("AUTH-P9A-1 - /_astro/<hash>.js traegt immutable + max-age fuer ein Jahr", async () => {
  const res = await fetch(`${srv.localUrl}/_astro/chunk.AbC12345.js`);
  assert.equal(res.status, HTTP_OK);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("AUTH-P9A-2 - HTML traegt no-cache (App-Shell und Marketing-Index)", async () => {
  const app = await fetch(`${srv.localUrl}/app/`);
  assert.equal(app.status, HTTP_OK);
  assert.equal(app.headers.get("cache-control"), "no-cache");

  const marketing = await fetch(`${srv.localUrl}/`);
  assert.equal(marketing.status, HTTP_OK);
  assert.equal(marketing.headers.get("cache-control"), "no-cache");
});

test("AUTH-P9A-3 - Gegenprobe: eine Datei NEBEN /_astro/ bekommt NICHT immutable", async () => {
  const res = await fetch(`${srv.localUrl}/assets/hero.js`);
  assert.equal(res.status, HTTP_OK);
  const cc = res.headers.get("cache-control");
  assert.doesNotMatch(cc, /immutable/, "nicht fingerprintet - immutable waere im Browser nicht mehr einholbar");
  assert.equal(cc, "public, max-age=0", "serve-static-Default steht unveraendert");
});

test("AUTH-P9A-4 - exakter Praefix: /_astrophysik/... bekommt NICHT immutable", async () => {
  const res = await fetch(`${srv.localUrl}/_astrophysik/hinweis.js`);
  assert.equal(res.status, HTTP_OK);
  const cc = res.headers.get("cache-control");
  assert.doesNotMatch(cc, /immutable/, "Praefix wird exakt gematcht, nicht 'enthaelt _astro'");
});

test("AUTH-P9A-5 - /api/plans traegt weiterhin no-store (middleware.js unberuehrt)", async () => {
  const res = await fetch(`${srv.localUrl}/api/plans`);
  assert.equal(res.status, HTTP_OK);
  assert.equal(res.headers.get("cache-control"), "no-store");
});
