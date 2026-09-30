// Fassungen der Website fuer KI-Agenten (Plan "agent-ready", Phase 1, 2026-09-30).
//
// Ein Agent, der die Startseite als HTML liest, sieht jeden Text mehrfach
// (Desktop-Buehne, Handy-Screens, Querformat-Blaetter) und die Preis-Rolle als
// Einzelziffern. Darum gibt es dieselben Inhalte als schlichtes Markdown:
//   /index.md       die Startseite (englisch, wie die indexierte Fassung)
//   /llms.txt       Kurzueberblick mit Fakten und Links (llmstxt.org)
//   /llms-full.txt  Startseite + Agenten-Anleitung (public/agents.md) in einer Datei
//
// Preise, Minuten und Tarifnamen kommen aus dem Tarif-Katalog (lib/plans.js), die
// Leistungen aus lib/plan-benefits.js - dieselben Quellen wie die Startseite.
// Reine Funktionen ohne import.meta.env: aus dem Node-Test UND dem Astro-Build
// aufrufbar. Die Login-URL reicht der Aufrufer herein (lib/routes.js braucht das
// Build-Env). test/agent-ready.test.js haelt MCP-URL, Befehl und Prompt gleich mit
// der gebauten Startseite.
import { PLAN_CATALOG, formatPlanPrice } from "./plans.js";
import { planBenefitsText } from "./plan-benefits.js";

export const SITE_URL = "https://sundartha.com";
export const MCP_URL = "https://app.sundartha.com/mcp";
// Name des Servers in den KI-Clients (claude mcp add ... hermes, Cursor, VS Code, Codex).
export const SERVER_NAME = "hermes";
export const MCP_CMD = `claude mcp add --transport http ${SERVER_NAME} ${MCP_URL}`;
export const CODEX_CMD = `codex mcp add ${SERVER_NAME} --url ${MCP_URL}`;
export const CODEX_LOGIN_CMD = `codex mcp login ${SERVER_NAME}`;
// Anzeige ohne Schema (Startseite), Link mit Schema.
export const AGENT_GUIDE = "sundartha.com/agents.md";
export const AGENT_GUIDE_URL = `https://${AGENT_GUIDE}`;
// Der Satz, den man in die eigene KI kopiert. "by Sundartha", weil "Hermes Agent"
// ein eigenes, bekanntes Agent-Framework ist (Plan agent-ready, Phase 3).
export const AGENT_LINE = {
  en: "Set up Hermes by Sundartha for me:",
  de: "Richte Hermes by Sundartha für mich ein:",
};
export const AGENT_PROMPT = `${AGENT_LINE.en} ${AGENT_GUIDE_URL}`;
// Die Website zeigt Menschen nichts vom Agenten-Ausbau (Owner 2026-09-30: "der User
// soll das nicht sehen, nur der Agent"). Der sichtbare Kopier-Satz behaelt darum seinen
// bisherigen Wortlaut; nur die Dateien fuer Agenten nutzen AGENT_PROMPT.
export const SITE_AGENT_LINE = { en: "Set up Hermes for me:", de: "Richte Hermes für mich ein:" };
export const SITE_AGENT_PROMPT = `${SITE_AGENT_LINE.en} ${AGENT_GUIDE_URL}`;
export const CONTACT_EMAIL = "kontakt@sundartha.com";
export const DASHBOARD_URL = "https://app.sundartha.com";

// Agent Skill auf der eigenen Domain (kein oeffentliches Repo, Owner 2026-09-30):
// public/.well-known/agent-skills/index.json (Discovery v0.2.0) + SKILL.md.
export const SKILL_NAME = "hermes-by-sundartha";
export const SKILL_CMD = `npx skills add ${SITE_URL}`;

// Ein-Klick-Installation. Cursor: Server-Konfiguration als Base64-JSON
// (cursor.com/docs/context/mcp/install-links). VS Code: URL-kodiertes JSON mit
// name/type/url (code.visualstudio.com/api/extension-guides/ai/mcp). Die Objekte stehen
// ausserhalb der Template-Strings: Semgrep (missing-template-string-indicator) haelt
// "{ ... }" in einem Template sonst fuer ein vergessenes "$".
const CURSOR_CONFIG = { url: MCP_URL };
const VSCODE_CONFIG = { name: SERVER_NAME, type: "http", url: MCP_URL };
export const CURSOR_INSTALL_URL = `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${btoa(JSON.stringify(CURSOR_CONFIG))}`;
export const VSCODE_INSTALL_URL = `vscode:mcp/install?${encodeURIComponent(JSON.stringify(VSCODE_CONFIG))}`;

const SUMMARY =
  "Hermes gives your AI a real phone number. It answers incoming calls, places outgoing calls on the user's behalf (Pro plan) and reports back. " +
  `One remote MCP server (Streamable HTTP, OAuth 2.1): ${MCP_URL}`;

const LEGAL_LINKS = [
  ["Privacy policy (German, binding)", "/datenschutz"],
  ["Privacy policy (English translation)", "/legal/privacy"],
  ["Imprint (German)", "/impressum"],
  ["Imprint (English translation)", "/legal/imprint"],
  ["Terms (German, binding)", "/agb"],
  ["Terms (English translation)", "/legal/terms"],
  ["Cancel contracts", "/kuendigen"],
  ["Support", "/support"],
];

function planFacts() {
  return PLAN_CATALOG.map((plan) => ({
    name: plan.name,
    price: formatPlanPrice(plan.amountCents, plan.currency, "en"),
    minutes: plan.includedMinutes,
    benefits: planBenefitsText(plan.slug, "en"),
  }));
}

function pricingTable() {
  const rows = planFacts().map(
    (plan) =>
      `| ${plan.name} | ${plan.price} / month | ${plan.minutes} minutes of calls per month | ${plan.benefits.join("; ")} |`,
  );
  return ["| Plan | Price | Included | What you get |", "|---|---|---|---|", ...rows].join("\n");
}

function linkList(links) {
  return links.map(([label, path]) => `- [${label}](${SITE_URL}${path})`).join("\n");
}

// Weitere Clients und der Skill: fuer /index.md und /llms.txt gleich.
function installSection() {
  return `More clients:

- Cursor: [Add to Cursor](${CURSOR_INSTALL_URL}) (one click), or add \`"${SERVER_NAME}": { "url": "${MCP_URL}" }\` under \`mcpServers\` in \`mcp.json\`.
- VS Code: [Install in VS Code](${VSCODE_INSTALL_URL}) (one click), or add \`"${SERVER_NAME}": { "type": "http", "url": "${MCP_URL}" }\` under \`servers\` in \`.vscode/mcp.json\`.
- Codex: \`${CODEX_CMD}\`, then \`${CODEX_LOGIN_CMD}\`.
- Agent Skill (Claude Code, Codex, Cursor, OpenClaw and other agents): \`${SKILL_CMD}\` installs the skill \`${SKILL_NAME}\`.`;
}

// Die Startseite als Markdown. loginUrl = LOGIN_URL aus lib/routes.js.
export function buildHomeMarkdown({ loginUrl }) {
  return `# Hermes by Sundartha: give your AI a phone number

> Hermes answers calls and handles them for you. One connection over MCP, and your AI gets a voice.

This is the Markdown version of ${SITE_URL}/ for AI agents. The page itself switches between English and German.

## How it works

One connection over MCP, no setup. Your AI is reachable on a real number in under two minutes.

1. **Get a number.** A real phone number. Active in two minutes. No contract, no hardware.
2. **Connect your AI.** One connection over MCP. Claude, Codex or any MCP client. Your AI knows who called.
3. **Let it answer.** Talks and listens. Books appointments. Your 24/7 personal assistant.

## Pricing

Two plans, no surprises. Cancel monthly, no hidden costs.

${pricingTable()}

Out of minutes? You get a heads-up, never an automatic surcharge.

Choose a plan after signing in: ${loginUrl}

## For developers

Hermes is an MCP server. Connect it in the AI tool of your choice or straight from the terminal.

- Server URL: \`${MCP_URL}\`
- Transport: Streamable HTTP. OAuth on first connect.
- Works with Claude, ChatGPT, Codex, Cursor, VS Code and any MCP client.

Three ways to connect:

1. **Add it as a connector.** Settings › Connectors › Add custom connector. Name \`Hermes\`, server URL \`${MCP_URL}\`.
2. **With a single command.** \`${MCP_CMD}\`
3. **Just ask your AI.** \`${AGENT_PROMPT}\`

${installSection()}

Step-by-step setup guide for AI agents: ${AGENT_GUIDE_URL}

## Links

${linkList(LEGAL_LINKS)}
- Contact: ${CONTACT_EMAIL}
`;
}

// llms.txt nach llmstxt.org: H1, Zusammenfassung als Zitat, Fakten, Link-Abschnitte.
export function buildLlmsTxt() {
  const plans = planFacts()
    .map(
      (plan) =>
        `  - ${plan.name}: ${plan.price} per month, ${plan.minutes} minutes of calls per month. ${plan.benefits.join(". ")}.`,
    )
    .join("\n");
  return `# Hermes by Sundartha

> ${SUMMARY}

Key facts:

- Plans (monthly, cancel any time, never an automatic surcharge):
${plans}
- Setup: add the MCP server to the AI client. The user signs in once in the browser (this creates the account) and picks a plan in the dashboard (${DASHBOARD_URL}). The phone number comes with the plan. Plans cannot be bought through MCP.
- Clients: any MCP client that can add a remote MCP server over Streamable HTTP with OAuth, for example Claude, Claude Code, ChatGPT, Codex, Cursor or VS Code.
- Name: the product is "Hermes by Sundartha". It is not related to other software called Hermes.

## For AI agents

- [Setup guide for AI agents](${AGENT_GUIDE_URL}): connect the MCP server, sign-in, getting a number, verifying, placing calls safely, troubleshooting.
- [Home page as Markdown](${SITE_URL}/index.md): what Hermes does, how it works, pricing, developer setup.
- [Everything in one file](${SITE_URL}/llms-full.txt): home page and setup guide together.
- [Agent Skill](${SITE_URL}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md): how to set up Hermes and place calls safely. Install with \`${SKILL_CMD}\`.

## Install

- Claude Code: \`${MCP_CMD}\`
- Claude (claude.ai, Desktop): Settings › Connectors › Add custom connector, server URL \`${MCP_URL}\`
- Codex: \`${CODEX_CMD}\`, then \`${CODEX_LOGIN_CMD}\`
- Cursor: ${CURSOR_INSTALL_URL}
- VS Code: ${VSCODE_INSTALL_URL}
- Any AI: \`${AGENT_PROMPT}\`

## Pages

- [Home](${SITE_URL}/): what Hermes does, pricing, developer setup (English, German toggle).
- [How it works](${SITE_URL}/#so-funktionierts): section of the home page.
- [Pricing](${SITE_URL}/#preise): section of the home page.
${linkList(LEGAL_LINKS)}
`;
}

// llms-full.txt: Startseite + Agenten-Anleitung, getrennt durch eine Linie.
export function buildLlmsFull({ loginUrl, agentGuide }) {
  const home = buildHomeMarkdown({ loginUrl });
  return `${home}\n---\n\n${agentGuide.trim()}\n`;
}
