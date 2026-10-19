import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importNachUmgebung } from "./umgebung-import.js";

test("test/cost-truing-harness.js sieht die Umgebung, wenn es nach ihr geladen wird", async (t) => {
  const datenverzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "kostenabgleich-umgebung-"));
  t.after(() => {
    delete process.env.DATA_DIR;
    delete process.env.EL_EVIDENCE_MIN_AGE_MINUTES;
    fs.rmSync(datenverzeichnis, { recursive: true, force: true });
  });
  const [{ fakeConfig }] = await importNachUmgebung(
    { DATA_DIR: datenverzeichnis, EL_EVIDENCE_MIN_AGE_MINUTES: "37" },
    () => import("../cost-truing-harness.js"),
  );
  assert.equal(fakeConfig().billing.elEvidenceMinAgeMinutes, 37);
});
