import { legacySnapshot } from "../mcp-draht-pfade.js";

const UI_AN = Object.freeze({ MCP_UI_ENABLED: "true" });
const WIDGET_AUS_URI = /^ui:\/\/hermes\/([^/]+)\//;
const SKRIPTBLOCK = /<script\b[^>]*>\n([\s\S]*?)\n[ \t]*<\/script\s*>/gi;

export async function ausgelieferteWidgets() {
  const { inhalte } = await legacySnapshot(UI_AN, { ressourcen: true });
  return Object.fromEntries(
    Object.entries(inhalte).map(([uri, html]) => [WIDGET_AUS_URI.exec(uri)[1], html]),
  );
}

export function skriptbloecke(html) {
  return [...html.matchAll(SKRIPTBLOCK)].map(([, inhalt]) => inhalt);
}
