import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../helpers.js";

const OTLP_SCHLUESSEL = ["METRIKEN_OTLP_URL", "METRIKEN_OTLP_BENUTZER", "METRIKEN_OTLP_TOKEN"];

test("Metrikweg: render.yaml fuehrt die OTLP-Schluessel ohne Wert (sync: false)", () => {
  const renderYaml = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8");
  for (const key of OTLP_SCHLUESSEL) {
    assert.match(
      renderYaml,
      new RegExp(`- key:\\s*${key}\\s*\\n\\s*sync:\\s*false`),
      `${key} fehlt (oder nicht sync:false) in render.yaml`,
    );
  }
});
