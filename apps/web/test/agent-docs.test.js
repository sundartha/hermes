// Reine Funktionen aus lib/agent-docs.js und lib/plan-benefits.js (ohne Build).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_CATALOG } from "../src/lib/plans.js";
import { PLAN_BENEFITS, planBenefitsText } from "../src/lib/plan-benefits.js";
import { buildHomeMarkdown, buildLlmsFull, buildLlmsTxt } from "../src/lib/agent-docs.js";

const LOGIN = "https://gateway.example/auth/login";

test("plan-benefits: jeder Katalog-Tarif hat drei Leistungen in EN und DE", () => {
  for (const plan of PLAN_CATALOG) {
    const byLang = PLAN_BENEFITS[plan.slug];
    for (const lang of ["en", "de"]) {
      const lines = planBenefitsText(plan.slug, lang);
      assert.equal(lines.length, byLang[lang].length);
      assert.ok(
        lines.every((line) => line && !/[<>]/.test(line)),
        `${plan.slug}/${lang}: Markup nicht entfernt`,
      );
    }
  }
  assert.throws(() => planBenefitsText("gibt-es-nicht", "en"));
});

test("index.md: Abschnitte, Tabelle, keine HTML-Reste", () => {
  const home = buildHomeMarkdown({ loginUrl: LOGIN });
  for (const heading of ["## How it works", "## Pricing", "## For developers", "## Links"]) {
    assert.ok(home.includes(heading), `${heading} fehlt`);
  }
  assert.ok(home.includes("| Plan | Price | Included | What you get |"));
  assert.ok(home.includes("Answers and calls out for you"), "Pro-Leistung ohne <em> fehlt");
  assert.ok(!/<\/?(em|strong|span)/.test(home), "HTML im Markdown");
  assert.ok(home.includes(LOGIN));
});

test("llms.txt: llmstxt.org-Form und Verweise auf die Agenten-Dateien", () => {
  const llms = buildLlmsTxt();
  assert.match(llms, /^# Hermes by Sundartha\n\n> .+\n/);
  for (const path of ["/agents.md", "/index.md", "/llms-full.txt"]) {
    assert.ok(llms.includes(`https://sundartha.com${path}`), `${path} fehlt`);
  }
});

test("llms-full.txt: Startseite, Trennlinie, Anleitung", () => {
  const full = buildLlmsFull({ loginUrl: LOGIN, agentGuide: "# Guide\n\ntext\n\n" });
  assert.ok(full.startsWith("# Hermes by Sundartha"));
  assert.ok(full.endsWith("\n---\n\n# Guide\n\ntext\n"));
});

test("index.md und llms.txt nennen Cursor, VS Code, Codex und den Skill", () => {
  const home = buildHomeMarkdown({ loginUrl: LOGIN });
  const llms = buildLlmsTxt();
  for (const doc of [home, llms]) {
    for (const needle of [
      "cursor://anysphere.cursor-deeplink/mcp/install",
      "vscode:mcp/install?",
      "codex mcp add hermes",
      "npx skills add https://sundartha.com",
    ]) {
      assert.ok(doc.includes(needle), `${needle} fehlt`);
    }
  }
  assert.ok(llms.includes("/.well-known/agent-skills/hermes-by-sundartha/SKILL.md"));
});
