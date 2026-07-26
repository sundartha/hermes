// W0 (Pre-Mortem a / R2): buildFilter-Guard. render.yaml MUSS die Deploy-Isolation
// zwischen dem live telefonierenden Gateway (vodafone-agent) und dem Static-Frontend
// (hermes-web) tragen, sonst kippt ein spaeterer YAML-Edit den Schutz lautlos:
//   (1) Gateway ignoriert apps/web/** (rein-Frontend-Commit redeployt den Gateway NICHT),
//   (2) Gateway ignoriert src/** NICHT (Backend-/Security-Fixes deployen weiterhin),
//   (3) hermes-web baut nur bei apps/web/** (paths-Whitelist).
// Reiner Datei-Read + Block-Split pro Service, keine yaml-Dependency (wie render-region.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RENDER_YAML = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "render.yaml");
const yaml = fs.readFileSync(RENDER_YAML, "utf8");

// Schneidet den render.yaml-Text in einen Block je Service (jeder Service beginnt
// mit "  - type:" auf Top-Level der services-Liste). So lassen sich paths/ignoredPaths
// dem richtigen Service zuordnen, statt blind ueber die ganze Datei zu greppen.
function serviceBlock(name) {
  const blocks = yaml.split(/^ {2}- type:/m).map((b) => "  - type:" + b);
  const block = blocks.find((b) => new RegExp(`^\\s*name:\\s*${name}\\b`, "m").test(b));
  assert.ok(block, `Service ${name} fehlt in render.yaml`);
  return block;
}

const gateway = serviceBlock("vodafone-agent");
const web = serviceBlock("hermes-web");

test("Gateway (vodafone-agent) ignoriert apps/web/** im buildFilter", () => {
  assert.match(gateway, /buildFilter:/, "Gateway hat keinen buildFilter");
  assert.match(gateway, /ignoredPaths:/, "Gateway-buildFilter hat keine ignoredPaths");
  assert.match(
    gateway,
    /ignoredPaths:[\s\S]*?-\s*["']?apps\/web\/\*\*/,
    "Gateway ignoriert apps/web/** NICHT -> Frontend-Commit wuerde den Gateway redeployen",
  );
});

test("Gateway ignoriert src/** NICHT (Backend-/Security-Fixes deployen weiter)", () => {
  // src/** darf in KEINEM ignoredPaths-Eintrag des Gateways stehen, sonst wuerden
  // Backend-Aenderungen nie ausgerollt (fail-open gegen Security-Fixes).
  assert.doesNotMatch(
    gateway,
    /ignoredPaths:[\s\S]*?-\s*["']?src\//,
    "Gateway ignoriert src/** -> Backend-/Security-Fixes wuerden nie deployen",
  );
});

test("Gateway-paths sind nicht gesetzt (sonst wuerde die Whitelist src/** verengen)", () => {
  // paths am Gateway waere eine Whitelist und koennte src/** versehentlich ausschliessen.
  // Die Isolation laeuft bewusst ueber ignoredPaths, nicht ueber paths.
  assert.doesNotMatch(
    gateway,
    /^\s*paths:/m,
    "Gateway nutzt buildFilter.paths -> Whitelist koennte src/**-Deploys still unterdruecken",
  );
});

test("hermes-web baut nur bei apps/web/** (paths-Whitelist)", () => {
  assert.match(web, /buildFilter:/, "hermes-web hat keinen buildFilter");
  assert.match(
    web,
    /paths:[\s\S]*?-\s*["']?apps\/web\/\*\*/,
    "hermes-web hat keine paths-Whitelist auf apps/web/** -> wuerde bei Backend-Commits bauen",
  );
});

test("hermes-web ist eine Static Site (type: web + runtime: static)", () => {
  assert.match(web, /^\s*-\s*type:\s*web\b/m, "hermes-web ist nicht type: web");
  assert.match(web, /^\s*runtime:\s*static\b/m, "hermes-web hat nicht runtime: static");
  assert.match(web, /^\s*staticPublishPath:\s*\S+/m, "hermes-web hat keinen staticPublishPath");
});

// GAP-37 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md; PLAN-I18N-TESTS.md
// W27). WIDERSPRUCH ZUM W0-TEST OBEN - und genau das ist der Befund: baut UND serviert
// derselbe Service apps/web, dann darf er apps/web/** nicht ignorieren, sonst deployt
// ein reiner Frontend-Commit nie und der Gateway liefert dauerhaft ein veraltetes
// Frontend aus. Aufloesbar nur durch eine Fix-Entscheidung (Build herausnehmen ODER
// ignoredPaths kuerzen), nicht durch Entschaerfen dieses Tests.
// GRENZE: geprueft wird der Blueprint, nicht der Render-Dashboard-Zustand (Live !=
// render.yaml).
test("GAP-37 (SOLL, rot) - der Gateway ignoriert apps/web nicht, obwohl er es baut und ausliefert", () => {
  const buildsWeb = /buildCommand:.*apps\/web/.test(gateway);
  const servesWeb = /key:\s*WEB_DIST_DIR\s*\n\s*value:\s*["']?apps\/web/.test(gateway);
  assert.ok(buildsWeb && servesWeb, "Praemisse der ID entfallen -> ID neu entscheiden, Test nicht drehen");
  assert.doesNotMatch(
    gateway,
    /ignoredPaths:[\s\S]*?-\s*["']?apps\/web\/\*\*/,
    "Gateway baut+serviert apps/web, darf es deshalb nicht im buildFilter ignorieren",
  );
});
