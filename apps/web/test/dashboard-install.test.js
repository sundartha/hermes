import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRINGS } from "../src/lib/i18n.js";

const DASHBOARD = readFileSync(new URL("../src/pages/app/index.astro", import.meta.url), "utf8");

test("Dashboard: der Install-Knopf führt auf die Einrichtung der Startseite", () => {
  const [knopf] = DASHBOARD.match(/<a [^>]*data-i18n="howToInstall"[^>]*>[^<]*<\/a>/) || [];
  assert.ok(knopf, "Install-Knopf fehlt im Dashboard");
  assert.match(knopf, /href=\{`\$\{SITE_URL\}\/#setup`\}/, "Install-Knopf zeigt nicht auf /#setup");
  assert.match(knopf, />How to install</);
});

test("Dashboard: der Install-Knopf heißt EN „How to install“ und DE „So installierst du es“", () => {
  assert.equal(STRINGS.en.howToInstall, "How to install");
  assert.equal(STRINGS.de.howToInstall, "So installierst du es");
});
