// W2-Test: Link-Audit gegen den GEBAUTEN Output. Jeder interne href einer
// oeffentlichen Seite zeigt auf eine existierende Astro-Route ODER den
// definierten Login-Einstieg ODER mailto:. Kein toter In-Page-Anker
// (#product/#pricing) mehr. Build-Operate-Check (P13), offline, self-validating.
//
// SCOPE: nur die oeffentlichen Seiten — NICHT der eingeloggte App-Bereich
// (/app), der W2-Out-of-Scope ist (analog pages.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LOGIN_URL } from "../src/lib/routes.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-test-links");

// Die oeffentlichen Seiten + ihr gebauter Pfad (Astro: /foo -> foo/index.html).
const PAGES = [
  "index.html",
  "so-funktionierts/index.html",
  "preise/index.html",
  "registrieren/index.html",
  "404.html",
  "impressum/index.html",
  "datenschutz/index.html",
  "agb/index.html",
];

// Gilt eine interne Route als existent? (gebauter Pfad pro href-Ziel)
function routeExists(href) {
  if (href === "/") return existsSync(join(DIST_DIR, "index.html"));
  const clean = href.replace(/^\//, "").replace(/\/$/, "");
  return (
    existsSync(join(DIST_DIR, clean, "index.html")) ||
    existsSync(join(DIST_DIR, `${clean}.html`))
  );
}

before(() => {
  rmSync(DIST_DIR, { recursive: true, force: true });
  execFileSync("npx", ["astro", "build", "--outDir", DIST_DIR], {
    cwd: WEB_ROOT,
    stdio: "pipe",
  });
});

test("kein toter In-Page-Anker (#product/#pricing) im Output", () => {
  for (const page of PAGES) {
    const html = readFileSync(join(DIST_DIR, page), "utf8");
    assert.ok(
      !/href="#product"|href="#pricing"/.test(html),
      `${page} enthaelt toten Anker`,
    );
  }
});

test("jeder interne href zeigt auf eine echte Route, LOGIN_URL oder mailto:", () => {
  for (const page of PAGES) {
    const html = readFileSync(join(DIST_DIR, page), "utf8");
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    for (const href of hrefs) {
      if (href.startsWith("mailto:")) continue;
      if (href === LOGIN_URL) continue; // Funnel-Einstieg (W3)
      if (!href.startsWith("/")) continue; // externe/Asset-URLs out-of-scope
      // Statische Assets sind keine navigierbaren Routen: /assets/ (public),
      // /_astro/ (Astro-Bundles, z.B. CSS-<link>), favicon.
      if (
        href.startsWith("/assets/") ||
        href.startsWith("/_astro/") ||
        href === "/favicon.svg"
      ) {
        continue;
      }
      assert.ok(routeExists(href), `${page}: totes internes Ziel ${href}`);
    }
  }
});

test("Pricing listet Business mit 1 Nummer (Q-ABO), nicht 3", () => {
  const html = readFileSync(join(DIST_DIR, "preise/index.html"), "utf8");
  assert.ok(html.includes("1 phone number"), "preise: '1 phone number' fehlt");
  assert.ok(
    !html.includes("3 phone number"),
    "preise: alter '3 phone numbers'-Tier noch vorhanden",
  );
});
