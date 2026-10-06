import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(__dirname, "../src/db/schema.sql"), "utf8");

test("S1: platform_number_use-Tabelle + Teilindex vorhanden", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS platform_number_use/);
  assert.match(
    schema,
    /CREATE UNIQUE INDEX IF NOT EXISTS platform_number_use_open_idx\s*\n\s*ON platform_number_use \(e164, purpose\) WHERE released_at IS NULL;/,
  );
});

test("S2: RLS ENABLE+FORCE und globale Policy mit vorangehendem DROP POLICY", () => {
  assert.match(schema, /ALTER TABLE platform_number_use ENABLE ROW LEVEL SECURITY;/);
  assert.match(schema, /ALTER TABLE platform_number_use FORCE\s+ROW LEVEL SECURITY;/);
  assert.match(schema, /DROP POLICY IF EXISTS tenant_isolation ON platform_number_use;/);
  assert.match(schema, /DROP POLICY IF EXISTS platform_number_use_global ON platform_number_use;/);
  assert.match(
    schema,
    /CREATE POLICY platform_number_use_global ON platform_number_use USING \(true\) WITH CHECK \(true\);/,
  );
});

test("S3: Idempotenz-Form - DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION (der zweite Boot darf nicht sterben)", () => {
  assert.match(schema, /DROP TRIGGER IF EXISTS number_platform_binding_guard ON number;/);
  assert.match(schema, /CREATE OR REPLACE FUNCTION number_platform_binding_guard\(\) RETURNS trigger AS \$\$/);
  assert.match(schema, /CREATE TRIGGER number_platform_binding_guard/);
});

test("S4: die WHEN-Klausel gatet auf den ZUSTANDSUEBERGANG, nicht auf den Zeilenzustand (Schutz gegen PM-11)", () => {
  assert.match(schema, /WHEN \(OLD\.status IS DISTINCT FROM NEW\.status/);
  assert.match(schema, /NEW\.status IN \('released','suspended'\)\)/);
});

test("S5: KEIN werfender BEFORE DELETE-Trigger auf number (Schutz gegen PM-12)", () => {
  const triggerBlocks = [...schema.matchAll(/CREATE TRIGGER[\s\S]*?ON number\b[\s\S]*?EXECUTE FUNCTION[^;]*;/g)];
  assert.equal(triggerBlocks.length, 1, "genau EIN Trigger auf number erwartet");
  assert.doesNotMatch(triggerBlocks[0][0], /BEFORE DELETE/);
  assert.match(triggerBlocks[0][0], /BEFORE UPDATE OF status ON number/);
});
