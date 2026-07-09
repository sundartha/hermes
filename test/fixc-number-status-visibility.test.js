// Fix C (PLAN-VOUCHER-SETUP-FEE-GAP.md, Phase C): FAILED/BLOCKED-Status sichtbar machen.
// Die eigentliche Verzweigungslogik (welcher numberStatus welchen Text ergibt) ist ueber
// test/number-status-view.test.js (Backend numberStatusFor) und apps/web/test/api.test.js
// (numberPlaceholderText) voll unit-getestet. tenant.html hat wie die uebrigen Statik-Tests
// dieser Datei (test/bk1-plan-price-format.test.js, test/p6-onboarding-funnel.test.js) keinen
// eigenen JS-Ausfuehrungs-Harness fuer diese Stelle -- eine Inhalts-Assertion auf dem
// committeten Rohtext (trusted, kein externer Input -> keine Injection) ist der precedented
// Weg, hier nur die Verdrahtung (agentNumberText existiert + wird tatsaechlich aufgerufen) zu
// pinnen ([Prozess/Repo]-Grenze, clean-code.md T2/T9).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

test("tenant.html: agentNumberText deckt failed/blocked mit eigenem Hinweis ab (Fix C)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(dir, "../public/tenant.html"), "utf8");
  assert.match(html, /function agentNumberText\(agent\)/);
  assert.match(html, /agent\.numberStatus===["']failed["']/);
  assert.match(html, /agent\.numberStatus===["']blocked["']/);
  assert.doesNotMatch(html, /agentNum"\)\.textContent\s*=\s*s\.agent\.number\s*\|\|/); // alter Fallback weg
  assert.match(html, /agentNum"\)\.textContent\s*=\s*agentNumberText\(s\.agent\)/);
});
