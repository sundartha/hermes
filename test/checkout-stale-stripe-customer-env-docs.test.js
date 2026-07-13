// Review-Fix (Fix B, Runde 1): STRIPE_CUSTOMER_RETRY_DELAY_MS ist in src/config.js
// zentralisiert (siehe src/config.js) - Repo-Konvention verlangt zusaetzlich
// Dokumentation in .env.example UND einen Eintrag in render.yaml. Reiner
// Datei-Read, keine Server-/Config-Imports (verhindert stille Rueckkehr der
// Luecke, ohne die Datei-Formate nachzubauen).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_EXAMPLE = path.join(REPO_ROOT, ".env.example");
const RENDER_YAML = path.join(REPO_ROOT, "render.yaml");
const VAR_NAME = "STRIPE_CUSTOMER_RETRY_DELAY_MS";

test(".env.example dokumentiert STRIPE_CUSTOMER_RETRY_DELAY_MS", () => {
  const envExample = fs.readFileSync(ENV_EXAMPLE, "utf8");
  assert.ok(
    new RegExp(`^${VAR_NAME}=`, "m").test(envExample),
    `${VAR_NAME} fehlt in .env.example`,
  );
});

test("render.yaml traegt STRIPE_CUSTOMER_RETRY_DELAY_MS ein", () => {
  const renderYaml = fs.readFileSync(RENDER_YAML, "utf8");
  assert.ok(
    new RegExp(`key:\\s*${VAR_NAME}`).test(renderYaml),
    `${VAR_NAME} fehlt in render.yaml`,
  );
});
