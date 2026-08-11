// W2-Test: Link-Audit gegen den GEBAUTEN Output. Jeder interne href einer
// oeffentlichen Seite zeigt auf eine existierende Astro-Route ODER eine externe
// URL (z.B. der absolute Gateway-Login LOGIN_URL) ODER mailto:. Kein toter
// In-Page-Anker (#product/#pricing) mehr. Build-Operate-Check (P13), offline,
// self-validating. Sichert zusaetzlich das Fail-Closed des Login-Origins ab.
//
// SCOPE: nur die oeffentlichen Seiten — NICHT der eingeloggte App-Bereich
// (/app), der W2-Out-of-Scope ist (analog pages.test.js).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-test-links");
// Separater Out-Dir fuer den Fail-Closed-Build (darf den Audit-Build nicht clobbern).
const FAILCLOSED_DIR = join(WEB_ROOT, "dist-test-failclosed");

// routes.js ist fail-closed: ohne PUBLIC_GATEWAY_URL bricht der Astro-Build UND der
// Import von routes.js absichtlich ab. Der Test stellt den Build-Origin bereit —
// genau wie render.yaml ihn beim hermes-web-Service setzt — und prueft danach, dass
// LOGIN_URL absolut auf <PUBLIC_GATEWAY_URL>/auth/login zeigt (kein relativer Pfad,
// der auf der Static Site 404 liefert). Gesetzt VOR dem (dynamischen) routes.js-Import
// und an den astro-build-Subprozess vererbt (execFileSync erbt process.env).
const GATEWAY_URL = "https://vodafone-agent.onrender.com";
process.env.PUBLIC_GATEWAY_URL = process.env.PUBLIC_GATEWAY_URL || GATEWAY_URL;
const EXPECTED_LOGIN_URL = `${process.env.PUBLIC_GATEWAY_URL}/auth/login`;

// Dynamisch (nicht statisch) importiert: ein statischer Top-Level-Import wird
// gehoistet und wuerde routes.js evaluieren, BEVOR process.env oben gesetzt ist.
let LOGIN_URL;

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

before(async () => {
  ({ LOGIN_URL } = await import("../src/lib/routes.js"));
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
      // LOGIN_URL ist jetzt absolut (anderer Origin = Gateway-Auth) und faellt
      // unter "externe URL" unten — keine Sonder-Ausnahme mehr noetig (W3 aufgeloest).
      if (!href.startsWith("/")) continue; // externe/Asset-URLs out-of-scope
      // Statische Assets sind keine navigierbaren Routen: /assets/ (public),
      // /_astro/ (Astro-Bundles, z.B. CSS-<link>), favicon.
      if (
        href.startsWith("/assets/") ||
        href.startsWith("/_astro/") ||
        href === "/favicon.svg" ||
        href === "/favicon.ico" ||
        href === "/apple-touch-icon.png"
      ) {
        continue;
      }
      assert.ok(routeExists(href), `${page}: totes internes Ziel ${href}`);
    }
  }
});

test("LOGIN_URL ist absolut auf den Gateway-Auth-Origin (kein relativer 404-Pfad)", () => {
  assert.equal(LOGIN_URL, EXPECTED_LOGIN_URL);
  assert.ok(
    LOGIN_URL.startsWith(process.env.PUBLIC_GATEWAY_URL),
    "LOGIN_URL enthaelt PUBLIC_GATEWAY_URL nicht",
  );
  assert.ok(/^https?:\/\//.test(LOGIN_URL), "LOGIN_URL ist nicht absolut");
  assert.ok(
    !LOGIN_URL.startsWith("/"),
    "LOGIN_URL ist noch ein relativer Static-Pfad (404-Gefahr)",
  );
});

test("gebaute Funnel-Seite verlinkt absolut auf den Gateway-Login (Build-Operate)", () => {
  const html = readFileSync(join(DIST_DIR, "index.html"), "utf8");
  assert.ok(
    html.includes(`href="${EXPECTED_LOGIN_URL}"`),
    `index: absoluter Login-Link ${EXPECTED_LOGIN_URL} fehlt im Output`,
  );
  assert.ok(
    !html.includes('href="/auth/login"'),
    "index: relativer /auth/login noch im Output (404-Gefahr)",
  );
});

test("Build ist fail-closed: ohne PUBLIC_GATEWAY_URL bricht er ab (kein stiller 404-Default)", () => {
  const env = { ...process.env };
  delete env.PUBLIC_GATEWAY_URL;
  let threw = false;
  let output = "";
  try {
    execFileSync("npx", ["astro", "build", "--outDir", FAILCLOSED_DIR], {
      cwd: WEB_ROOT,
      stdio: "pipe",
      env,
    });
  } catch (err) {
    threw = true;
    output = `${err.stderr || ""}${err.stdout || ""}${err.message || ""}`;
  } finally {
    rmSync(FAILCLOSED_DIR, { recursive: true, force: true });
  }
  assert.ok(threw, "Build haette ohne PUBLIC_GATEWAY_URL fehlschlagen muessen");
  assert.match(output, /PUBLIC_GATEWAY_URL/, "Build-Fehler nennt die fehlende Var nicht");
});

// Q-ABO: ein Abo = genau EINE Nummer. Der alte englische Tier-Text versprach
// bei Business drei. Die deutsche Neubau-Fassung nennt gar keine Nummernzahl
// mehr (Merkmale = Minuten + Faehigkeiten), darum bleibt hier der negative
// Waechter: kein Mehrzahl-Versprechen darf zurueckkommen — weder deutsch noch
// englisch. Sobald die Seite wieder eine Zahl nennt, muss sie 1 sein.
test("Pricing verspricht keine Mehrfach-Nummern (Q-ABO: ein Abo = eine Nummer)", () => {
  const html = readFileSync(join(DIST_DIR, "preise/index.html"), "utf8");
  for (const claim of [
    /\b([2-9]|\d{2,})\s+phone numbers?\b/i,
    /\b([2-9]|\d{2,})\s+(Rufnummern|Nummern)\b/i,
  ]) {
    assert.ok(!claim.test(html), `preise: Mehrfach-Nummern-Versprechen (${claim}) im Output`);
  }
  const numberClaim = html.match(/\b(\d+)\s+(phone numbers?|Rufnummern?|Nummern?)\b/i);
  if (numberClaim) {
    assert.equal(numberClaim[1], "1", `preise: Nummernzahl ${numberClaim[0]} widerspricht Q-ABO`);
  }
});
