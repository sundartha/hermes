import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RENDER_YAML = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "render.yaml");
const yaml = fs.readFileSync(RENDER_YAML, "utf8");

function serviceBlock(name) {
  const blocks = yaml.split(/^ {2}- type:/m).map((b) => "  - type:" + b);
  const block = blocks.find((b) => new RegExp(`^\\s*name:\\s*${name}\\b`, "m").test(b));
  assert.ok(block, `Service ${name} fehlt in render.yaml`);
  return block;
}

const gateway = serviceBlock("vodafone-agent");
const web = serviceBlock("hermes-web");

test("Gateway (vodafone-agent) filtert reine Doku-Commits ueber buildFilter.ignoredPaths", () => {
  assert.match(gateway, /buildFilter:/, "Gateway hat keinen buildFilter");
  assert.match(gateway, /ignoredPaths:/, "Gateway-buildFilter hat keine ignoredPaths");
  assert.match(
    gateway,
    /ignoredPaths:[\s\S]*?-\s*["']?docs\/\*\*/,
    "Gateway ignoriert docs/** NICHT -> ein reiner Doku-Commit wuerde den Gateway redeployen",
  );
});

test("Gateway ignoriert src/** NICHT (Backend-/Security-Fixes deployen weiter)", () => {
  assert.doesNotMatch(
    gateway,
    /ignoredPaths:[\s\S]*?-\s*["']?src\//,
    "Gateway ignoriert src/** -> Backend-/Security-Fixes wuerden nie deployen",
  );
});

test("Gateway-paths sind nicht gesetzt (sonst wuerde die Whitelist src/** verengen)", () => {
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
