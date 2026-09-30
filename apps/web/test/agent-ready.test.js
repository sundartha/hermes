// Plan "agent-ready" (2026-09-30): die Fassungen der Website fuer KI-Agenten.
// /index.md, /llms.txt und /llms-full.txt entstehen beim Build aus lib/agent-docs.js,
// der Skill und der Registry-Nachweis liegen unter public/.well-known/. Eigener
// Test-Build im Temp-Verzeichnis, damit pages.test.js unveraendert bleibt.
// Owner-Regel: Menschen sehen auf der Startseite nichts vom Agenten-Ausbau.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PLAN_CATALOG, formatPlanPrice } from "../src/lib/plans.js";
import { LOGIN_URL } from "../src/lib/routes.js";
import {
  AGENT_PROMPT,
  CURSOR_INSTALL_URL,
  MCP_CMD,
  MCP_URL,
  SITE_AGENT_PROMPT,
  SKILL_NAME,
  VSCODE_INSTALL_URL,
} from "../src/lib/agent-docs.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = mkdtempSync(join(tmpdir(), "dist-test-agent-"));

function readDist(relativePath) {
  return readFileSync(join(DIST_DIR, relativePath), "utf8");
}

before(() => {
  execFileSync("npx", ["astro", "build", "--outDir", DIST_DIR], {
    cwd: WEB_ROOT,
    stdio: "pipe",
  });
});

after(() => {
  rmSync(DIST_DIR, { recursive: true, force: true });
});

// Agenten-Fassungen (Plan "agent-ready", Phase 1): /index.md, /llms.txt und
// /llms-full.txt entstehen beim Build aus lib/agent-docs.js. Sie muessen dieselben
// Fakten tragen wie die gebaute Startseite, sonst liest ein Agent etwas anderes als
// der Mensch.
test("Agenten-Fassungen: index.md, llms.txt, llms-full.txt werden gebaut", () => {
  for (const file of ["index.md", "llms.txt", "llms-full.txt"]) {
    assert.ok(existsSync(join(DIST_DIR, file)), `${file} fehlt im Build`);
  }
  const home = readDist("index.md");
  const llms = readDist("llms.txt");
  for (const plan of PLAN_CATALOG) {
    const price = formatPlanPrice(plan.amountCents, plan.currency, "en");
    for (const doc of [home, llms]) {
      assert.ok(doc.includes(plan.name), `Tarifname ${plan.name} fehlt`);
      assert.ok(doc.includes(price), `Preis ${price} fehlt`);
      assert.ok(
        doc.includes(`${plan.includedMinutes} minutes`),
        `${plan.includedMinutes} Minuten fehlen`,
      );
    }
  }
  assert.ok(home.includes(LOGIN_URL), "index.md: Login-URL fehlt");
  assert.match(
    llms,
    /^# Hermes by Sundartha\n\n> /,
    "llms.txt: H1 + Zusammenfassung nach llmstxt.org",
  );
  const agents = readFileSync(join(WEB_ROOT, "public/agents.md"), "utf8");
  const full = readDist("llms-full.txt");
  assert.ok(full.startsWith(home.trimEnd()), "llms-full.txt beginnt nicht mit index.md");
  assert.ok(full.includes(agents.trim()), "llms-full.txt enthaelt agents.md nicht vollstaendig");
  assert.ok(
    !existsSync(join(WEB_ROOT, "public/llms.txt")),
    "public/llms.txt wuerde den gebauten Endpunkt verdecken",
  );
});

test("Agenten-Fassungen: MCP-URL, Befehl und Prompt gleichen der Startseite", () => {
  const html = readDist("index.html");
  const home = readDist("index.md");
  for (const value of [MCP_URL, MCP_CMD]) {
    assert.ok(
      html.includes(value),
      `Startseite nennt "${value}" nicht (Drift zu lib/agent-docs.js)`,
    );
    assert.ok(home.includes(value), `index.md nennt "${value}" nicht`);
  }
  assert.ok(html.includes(SITE_AGENT_PROMPT), "Startseite: sichtbarer Kopier-Satz fehlt");
  assert.ok(home.includes(AGENT_PROMPT), "index.md: Prompt fuer Agenten fehlt");
  assert.match(
    html,
    /<link rel="alternate" type="text\/markdown" href="https:\/\/sundartha\.com\/index\.md"/,
    "Startseite verlinkt ihre Markdown-Fassung nicht",
  );
});

test("Handy-Preise: Rolle aria-hidden, je Tarif ein vorlesbarer Satz", () => {
  const html = readDist("index.html");
  const section = html.slice(html.indexOf('aria-labelledby="mh-price-title"'));
  const priceScreen = section.slice(0, section.indexOf("</section>"));
  assert.match(
    priceScreen,
    /class="mh-focus[^"]*" aria-hidden="true"/,
    "Preis-Rolle ist nicht aria-hidden",
  );
  const items = [...priceScreen.matchAll(/<ul class="mh-sr">([\s\S]*?)<\/ul>/g)];
  assert.equal(items.length, 1, "Vorlese-Liste fehlt");
  for (const plan of PLAN_CATALOG) {
    const en = `${plan.name}: ${formatPlanPrice(plan.amountCents, plan.currency, "en")} per month`;
    const de = `${plan.name}: ${formatPlanPrice(plan.amountCents, plan.currency, "de")} pro Monat`;
    assert.ok(items[0][1].includes(en), `Vorlese-Satz EN fehlt: ${en}`);
    assert.ok(items[0][1].includes(de), `Vorlese-Satz DE fehlt: ${de}`);
  }
});

test("robots.txt: Content-Signal erlaubt Suche, KI-Antworten und Training", () => {
  const robots = readFileSync(join(WEB_ROOT, "public/robots.txt"), "utf8");
  assert.match(robots, /^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m);
  assert.match(robots, /^Disallow: \/app$/m);
});

// Plan agent-ready, Phase 2-4: Skill auf der eigenen Domain, Registry-Nachweis,
// Ein-Klick-Links und strukturierte Daten.
const SKILL_DESCRIPTION_MAX = 1024; // agentskills.io/specification
const REGISTRY_DESCRIPTION_MAX = 100; // MCP-Registry server.json
const CENTS_PER_EURO = 100;
const PRICE_DECIMALS = 2;
test("Agent Skill: Discovery-Index v0.2.0 passt zu SKILL.md (Name, Beschreibung, Digest)", () => {
  const index = JSON.parse(readDist(".well-known/agent-skills/index.json"));
  assert.equal(index.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json");
  assert.equal(index.skills.length, 1);
  const [entry] = index.skills;
  assert.equal(entry.name, SKILL_NAME);
  assert.equal(entry.type, "skill-md");
  assert.equal(entry.url, `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`);
  const skill = readFileSync(join(DIST_DIR, entry.url.slice(1)));
  const digest = createHash("sha256").update(skill).digest("hex");
  assert.equal(
    entry.digest,
    `sha256:${digest}`,
    "Digest veraltet: index.json nach SKILL.md-Aenderung neu rechnen",
  );
  const text = skill.toString("utf8");
  assert.match(text, new RegExp(`^---\nname: ${SKILL_NAME}\ndescription: `));
  const [, afterKey] = text.split("description: ");
  const [description] = afterKey.split("\n");
  assert.equal(
    entry.description,
    description,
    "Beschreibung in index.json und SKILL.md weichen ab",
  );
  assert.ok(description.length <= SKILL_DESCRIPTION_MAX, "Beschreibung zu lang");
  const agents = readFileSync(join(WEB_ROOT, "public/agents.md"), "utf8");
  for (const tool of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
    assert.ok(agents.includes(tool[1]), `SKILL.md nennt ${tool[1]}, agents.md nicht`);
  }
  assert.ok(text.includes(MCP_URL));
});

test("MCP Registry: Domain-Nachweis und server.json fuer com.sundartha/hermes", () => {
  const auth = readDist(".well-known/mcp-registry-auth");
  assert.match(auth, /^v=MCPv1; k=ed25519; p=[A-Za-z0-9+/]{43}=\n$/);
  const server = JSON.parse(
    readFileSync(join(WEB_ROOT, "../../docs/mcp-registry/server.json"), "utf8"),
  );
  assert.match(server.name, /^com\.sundartha\//);
  assert.deepEqual(server.remotes, [{ type: "streamable-http", url: MCP_URL }]);
  assert.ok(server.description.length <= REGISTRY_DESCRIPTION_MAX, "Registry-Beschreibung zu lang");
});

// Owner 2026-09-30: Menschen sehen vom Agenten-Ausbau nichts. Die Ein-Klick-Links und die
// neue Client-Liste stehen nur in den Agenten-Dateien, nicht auf der Startseite.
test("Startseite: nichts Sichtbares fuer Agenten, strukturierte Daten aus dem Katalog", () => {
  const html = readDist("index.html");
  for (const marker of ["cursor://", "vscode:mcp", "Add to Cursor", "by Sundartha for me"]) {
    assert.ok(!html.includes(marker), `Startseite zeigt Agenten-Inhalt: ${marker}`);
  }
  const config = JSON.parse(atob(new URL(CURSOR_INSTALL_URL).searchParams.get("config")));
  assert.deepEqual(config, { url: MCP_URL });
  const vscode = JSON.parse(decodeURIComponent(VSCODE_INSTALL_URL.split("?")[1]));
  assert.deepEqual(vscode, { name: "hermes", type: "http", url: MCP_URL });
  const block = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(block, "JSON-LD fehlt");
  const graph = JSON.parse(block[1])["@graph"];
  const app = graph.find((node) => node["@type"] === "SoftwareApplication");
  assert.equal(app.offers.length, PLAN_CATALOG.length);
  for (const [index, plan] of PLAN_CATALOG.entries()) {
    assert.equal(app.offers[index].name, plan.name);
    assert.equal(
      app.offers[index].price,
      (plan.amountCents / CENTS_PER_EURO).toFixed(PRICE_DECIMALS),
    );
  }
});

test("agents.md: Ein-Klick-Links fuer Cursor und VS Code stimmen mit lib/agent-docs.js", () => {
  const agents = readFileSync(join(WEB_ROOT, "public/agents.md"), "utf8");
  assert.ok(agents.includes(CURSOR_INSTALL_URL), "agents.md: Cursor-Link veraltet");
  assert.ok(agents.includes(VSCODE_INSTALL_URL), "agents.md: VS-Code-Link veraltet");
});
