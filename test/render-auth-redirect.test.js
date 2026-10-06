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

const web = serviceBlock("hermes-web");

test("hermes-web leitet /auth/* per redirect auf den Gateway-Auth-Origin um", () => {
  assert.match(web, /routes:/, "hermes-web hat keinen routes-Block");
  assert.match(
    web,
    /-\s*type:\s*redirect[\s\S]*?source:\s*\/auth\/\*[\s\S]*?destination:\s*https:\/\/[^/\s]+\/auth\/:splat/,
    "hermes-web hat keine redirect-Regel /auth/* -> Gateway -> Deep-Links auf sundartha.com/auth/* wuerden 404en",
  );
});

test("hermes-web behaelt den /app/*-SPA-rewrite (Regressions-Guard)", () => {
  assert.match(
    web,
    /-\s*type:\s*rewrite[\s\S]*?source:\s*\/app\/\*[\s\S]*?destination:\s*\/app\/index\.html/,
    "hermes-web hat den /app/*-rewrite verloren",
  );
});

function originOf(rawUrl) {
  return new URL(rawUrl).origin;
}

test("hermes-web PUBLIC_GATEWAY_URL und /auth/*-Redirect nennen denselben Gateway-Auth-Origin", () => {
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
