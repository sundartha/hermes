import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RENDER_YAML = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "render.yaml");
const EU_REGION = "frankfurt";
const NON_EU_REGIONS = ["oregon", "ohio", "virginia", "singapore"];

const yaml = fs.readFileSync(RENDER_YAML, "utf8");

test("render.yaml hat eine region und sie ist EU (frankfurt)", () => {
  const match = yaml.match(/^\s*region:\s*(\S+)/m);
  assert.ok(match, "region fehlt in render.yaml");
  assert.equal(match[1], EU_REGION);
});

test("render.yaml nutzt KEINE bekannte Nicht-EU-Region (fail-closed)", () => {
  for (const region of NON_EU_REGIONS) {
    assert.ok(!new RegExp(`region:\\s*${region}`).test(yaml), `Nicht-EU-Region ${region} gesetzt`);
  }
});
