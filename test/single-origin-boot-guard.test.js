import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, assertConfig } from "../src/config.js";
import { makeConfigOverrides } from "./helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

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

const REQUIRED_OK = {
  anthropicApiKey: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
};
const WEB_DIST_MSG = "WEB_DIST_DIR-Build";

test("WEB_DIST_DIR gesetzt, aber kein index.html -> assertConfig false + nennt WEB_DIST_DIR", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-webdist-noindex-"));
  try {
    withConfigOverrides({ ...REQUIRED_OK, webDistDir: dir }, () => {
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
    withConfigOverrides({ ...REQUIRED_OK, webDistDir: dir }, () => {
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
