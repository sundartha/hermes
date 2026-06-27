// P1 — Single-Origin-Boot-Guard: assertConfig() verweigert den Boot, wenn WEB_DIST_DIR
// gesetzt ist, der Build (<dir>/index.html) aber fehlt - fail-closed (sichtbarer Boot-
// Fehler statt stiller 401: ohne index.html faende express.static nichts, jeder
// Marketing-Request fiele auf die Basic-Auth durch). Rein-Unit gegen die config-Funktion
// (kein Server-Spawn, kein pglite). Eigene Testdatei mit SAUBEREM Modul-Scope: config.js
// haelt fatalConfigErrors modulweit; ein numEnv-polluter (config-failclosed.test.js)
// wuerde die Gegenprobe (assertConfig() === true) verfaelschen - hier akkumuliert nichts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, assertConfig } from "../src/config.js";

// console.error abfangen (Diagnose-Zeilen pruefen), ohne den Testlauf zuzumuellen.
function captureConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

// Pflichtfelder erfuellen (sonst faellt assertConfig aus anderen Gruenden), NUR webDistDir
// variieren. Restore am Ende.
const REQUIRED_OK = {
  anthropicApiKey: "x",
  twilioSid: "x",
  twilioToken: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
};
function withConfig(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = config[k];
  Object.assign(config, overrides);
  try {
    return fn();
  } finally {
    Object.assign(config, saved);
  }
}

const WEB_DIST_MSG = "WEB_DIST_DIR-Build";

test("WEB_DIST_DIR gesetzt, aber kein index.html -> assertConfig false + nennt WEB_DIST_DIR", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-webdist-noindex-"));
  try {
    withConfig({ ...REQUIRED_OK, webDistDir: dir }, () => {
      const lines = captureConsoleError(() => {
        assert.equal(assertConfig(), false, "fehlendes index.html -> Boot-Refusal");
      });
      assert.ok(
        lines.join("\n").includes(WEB_DIST_MSG),
        "Diagnose muss die WEB_DIST_DIR-Build-Meldung nennen",
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Gegenprobe: WEB_DIST_DIR mit index.html -> assertConfig true, kein WEB_DIST_DIR-Flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-webdist-ok-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>ok</title>");
  try {
    withConfig({ ...REQUIRED_OK, webDistDir: dir }, () => {
      const lines = captureConsoleError(() => {
        assert.equal(assertConfig(), true, "vorhandenes index.html -> Boot ok");
      });
      assert.ok(
        !lines.join("\n").includes(WEB_DIST_MSG),
        "kein WEB_DIST_DIR-Build-Flag wenn index.html existiert",
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
