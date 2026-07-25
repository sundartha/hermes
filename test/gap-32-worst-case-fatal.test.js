// GAP-32 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-32").
// Ein unbezahlbarer Worst-Case-Tarif bricht den Start nicht, sondern warnt nur:
// spendCapCoherence() liefert den Befund WORST_CASE_UNAFFORDABLE bewusst mit
// fatal:false (src/boot-guard.js:114-127). Datei-Test gegen render.yaml, Muster
// test/env-docs-spend-cap-coherence.test.js (readRenderValue + spendCapCoherence).
//
// Live-Zahlen (tasks/i18n-tests/13-live-env-befund.md Abschnitt 3, NICHT die aelteren
// Katalog-Zahlen 900/300): render.yaml traegt MAX_BUDGET_EUR=8 (platformCapCents=800),
// DEFAULT_TENANT_BUDGET_CENTS=600, VOICE_TARIFF_DEFAULT_CENTS=300 -> mit dem REALEN
// Worst-Case-Anrufdauer-Deckel MAX_CALL_DURATION_CAP_S=300 (src/store/defaults.js:253,
// NICHT render.yaml's MAX_CALL_DURATION_S=180, das ist nur der Anfrage-Default) ergibt
// sich Reserve=1500 gegen Decke=600 - exakt die Zahlen aus dem Boot-Banner.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eurToCents } from "../src/config.js";
import { spendCapCoherence, SPEND_CAP_FINDING } from "../src/boot-guard.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_YAML = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

function readRenderValue(text, name) {
  const m = text.match(new RegExp(`key:\\s*${name}\\s*\\n\\s*value:\\s*"?([^"\\n]+)"?`));
  if (!m) throw new Error(`${name} nicht in render.yaml gefunden`);
  return m[1].trim();
}

test("GAP-32 SOLL: der WORST_CASE_UNAFFORDABLE-Befund muss den Start abbrechen (fatal:true), nicht nur warnen", () => {
  const tenantDefaultCents = Number(readRenderValue(RENDER_YAML, "DEFAULT_TENANT_BUDGET_CENTS"));
  const platformCapCents = eurToCents(Number(readRenderValue(RENDER_YAML, "MAX_BUDGET_EUR")));
  const maxTariffCents = Number(readRenderValue(RENDER_YAML, "VOICE_TARIFF_DEFAULT_CENTS"));
  assert.equal(tenantDefaultCents, 600, "Vorbedingung: live-gemessene Tenant-Decke");
  assert.equal(platformCapCents, 800, "Vorbedingung: Plattform-Cap (MAX_BUDGET_EUR=8)");
  assert.equal(maxTariffCents, 300, "Vorbedingung: live-gemessener Worst-Case-Tarif");

  const findings = spendCapCoherence({
    tenantDefaultCents,
    platformCapCents,
    maxTariffCents,
    maxCallDurationS: MAX_CALL_DURATION_CAP_S,
  });
  const worstCase = findings.find((f) => f.code === SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE);
  assert.ok(
    worstCase,
    `Vorbedingung: render.yaml muss den WORST_CASE_UNAFFORDABLE-Befund ausloesen, war: ${JSON.stringify(findings)}`,
  );
  assert.match(worstCase.message, /1500 Cent/, "Vorbedingung: die live-gemessene Reserve (1500 ct)");

  assert.equal(
    worstCase.fatal,
    true,
    "SOLL: ein Land im Gate, dessen Worst-Case-Tarif die kleinste Plan-Decke sprengt, muss " +
      "den Start abbrechen - heute ist der Befund ausdruecklich fatal:false " +
      "(src/boot-guard.js:114-127), die Warnzeile steht seit dem ersten Deploy folgenlos im Log",
  );
});
