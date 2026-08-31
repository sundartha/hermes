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
  // Geprueft wird, DASS die Regel existiert und auf einen https-Auth-Origin zeigt --
  // NICHT auf welchen. Der konkrete Origin ist Gegenstand des Track-B-Cutovers und
  // steht in PUBLIC_GATEWAY_URL; dass beide denselben nennen, sichert der dritte Test
  // dieser Datei (Atomaritaets-Guard). Ein hier eingefrorener Hostname wuerde jeden
  // legitimen Cutover rot faerben, ohne zusaetzliche Sicherheit zu geben.
  assert.match(
    web,
    /-\s*type:\s*redirect[\s\S]*?source:\s*\/auth\/\*[\s\S]*?destination:\s*https:\/\/[^/\s]+\/auth\/:splat/,
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

// Liest einen einzelnen Wert aus dem hermes-web-Block. Beide Origins (Funnel-Link
// und Deep-Link-Redirect) muessen denselben Gateway-Auth-Origin nennen.
function originOf(rawUrl) {
  return new URL(rawUrl).origin;
}

test("hermes-web PUBLIC_GATEWAY_URL und /auth/*-Redirect nennen denselben Gateway-Auth-Origin", () => {
  // Regressions-Guard gegen halben Track-B-Cutover (P5): Aendert man PUBLIC_GATEWAY_URL
  // (Funnel-Links -> routes.js) ohne die /auth/*-Redirect-Destination (oder umgekehrt),
  // zeigt der Login-Link auf eine Domain, die render.yaml nicht zum Gateway routet ->
  // HTTP-400 / ausgesperrte Nutzer. Der Cutover ist nur atomar (beide zusammen) zulaessig.
  const gatewayUrl = web.match(/key:\s*PUBLIC_GATEWAY_URL[\s\S]*?value:\s*"?(https:\/\/[^"\s]+)"?/);
  assert.ok(gatewayUrl, "hermes-web hat keine PUBLIC_GATEWAY_URL gesetzt");
  const redirect = web.match(/-\s*type:\s*redirect[\s\S]*?source:\s*\/auth\/\*[\s\S]*?destination:\s*(https:\/\/[^/\s]+)\/auth\/:splat/);
  assert.ok(redirect, "hermes-web hat keine /auth/*-Redirect-Destination");
  assert.equal(
    originOf(gatewayUrl[1]),
    originOf(redirect[1]),
    "PUBLIC_GATEWAY_URL und /auth/*-Redirect zeigen auf verschiedene Origins -> halber Cutover, Login-Link bricht",
  );
});
