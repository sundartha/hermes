// P2a (Messbarkeit: Ergebnisse sichtbar) - tenant.html rendert jetzt Summary +
// Ziel-Chip im Anrufe-Kartenrumpf und einen eigenen Meldungs-Feed. Statik-/
// Verdrahtungstest auf dem committeten Rohtext, wie die uebrigen tenant.html-Tests
// dieser Suite (test/fixc-number-status-visibility.test.js,
// test/phase-a-setup-fee-tenant-html.test.js): tenant.html hat keinen eigenen JS-
// Ausfuehrungs-Harness -> [Prozess/Repo]-Grenze (clean-code.md T2/T9). Diese Datei
// pinnt nur die Verdrahtung (die Funktionen existieren UND werden im Render tatsaechlich
// aufgerufen), nicht die visuelle Optik (bleibt Smoke-Sache, CLAUDE.md "Befehle").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function readTenantHtml() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dir, "../public/tenant.html"), "utf8");
}

test("tenant.html: Summary + Ziel-Chip sind im Call-Render verdrahtet (P2a)", () => {
  const html = readTenantHtml();
  assert.match(html, /function objectiveChip\(value\)/);
  assert.match(html, /function callBody\(c\)/);
  assert.match(html, /\$\{callBody\(c\)\}/); // callBody wird in renderCalls WIRKLICH aufgerufen
  assert.match(html, /esc\(c\.summary\)/);
  assert.match(html, /class="obj \$\{chip\.cls\}"/);
});

test("tenant.html: Meldungs-Feed ist verdrahtet und ohne Server-Feld versteckt (P2a)", () => {
  const html = readTenantHtml();
  assert.match(html, /function renderNotifications\(notifications\)/);
  assert.match(html, /renderNotifications\(s\.notifications\)/); // Aufruf in refresh()
  assert.match(html, /id="notifCard"/);
  assert.match(html, /if\(!Array\.isArray\(notifications\)\)\{\s*card\.style\.display="none"/);
  assert.match(html, /esc\(n\.title\)/);
  assert.match(html, /esc\(n\.body\)/);
});
