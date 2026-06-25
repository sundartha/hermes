// Bug B / Phase 2 (Deep-Link-Hardening): render.yaml MUSS am hermes-web Static-Service
// eine redirect-Regel /auth/* -> Gateway-Auth-Origin tragen. Sonst 404en direkt
// eingegebene/gebookmarkte/alt-verlinkte sundartha.com/auth/*-URLs (die Static Site
// hat selbst kein /auth/*; OIDC lebt auf dem Gateway). Die Funnel-Links zeigen zwar
// absolut auf den Gateway (apps/web/src/lib/routes.js -> PUBLIC_GATEWAY_URL), aber
// Deep-Links umgehen die Funnel-Konstante. Reiner Datei-Read + Block-Split pro Service,
// keine yaml-Dependency (wie render-buildfilter.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RENDER_YAML = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "render.yaml");
const yaml = fs.readFileSync(RENDER_YAML, "utf8");

// Schneidet render.yaml in einen Block je Service (jeder Service beginnt mit
// "  - type:" auf Top-Level der services-Liste), damit routes dem richtigen Service
// zugeordnet werden statt blind ueber die ganze Datei zu greppen.
function serviceBlock(name) {
  const blocks = yaml.split(/^ {2}- type:/m).map((b) => "  - type:" + b);
  const block = blocks.find((b) => new RegExp(`^\\s*name:\\s*${name}\\b`, "m").test(b));
  assert.ok(block, `Service ${name} fehlt in render.yaml`);
  return block;
}

const web = serviceBlock("hermes-web");

test("hermes-web leitet /auth/* per redirect auf den Gateway-Auth-Origin um", () => {
  assert.match(web, /routes:/, "hermes-web hat keinen routes-Block");
  assert.match(
    web,
    /-\s*type:\s*redirect[\s\S]*?source:\s*\/auth\/\*[\s\S]*?destination:\s*https:\/\/vodafone-agent\.onrender\.com\/auth\/:splat/,
    "hermes-web hat keine redirect-Regel /auth/* -> Gateway -> Deep-Links auf sundartha.com/auth/* wuerden 404en",
  );
});

test("hermes-web behaelt den /app/*-SPA-rewrite (Regressions-Guard)", () => {
  // Der neue /auth/*-redirect darf den bestehenden SPA-Fallback nicht verdraengen.
  assert.match(
    web,
    /-\s*type:\s*rewrite[\s\S]*?source:\s*\/app\/\*[\s\S]*?destination:\s*\/app\/index\.html/,
    "hermes-web hat den /app/*-rewrite verloren",
  );
});
