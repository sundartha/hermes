import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const defaultsSrc = fs.readFileSync(path.join(dir, "../src/store/defaults.js"), "utf8");
const schemaSrc = fs.readFileSync(path.join(dir, "../src/db/schema.sql"), "utf8");
const TZ_PATTERN = /timezone|timeZone/;

test("Datenmodell traegt ein timezone-Feld am Tenant (JSON-Defaults UND Postgres-Schema) (ex FMT-28)", () => {
  assert.ok(
    TZ_PATTERN.test(defaultsSrc),
    "src/store/defaults.js muss ein timezone/timeZone-Feld kennen (Entscheidung 7.6: Zeitzonen-Anzeige am Tenant)",
  );
  assert.ok(
    TZ_PATTERN.test(schemaSrc),
    "src/db/schema.sql muss eine timezone-Spalte kennen (Postgres-Backend muss dasselbe Feld persistieren)",
  );
});
