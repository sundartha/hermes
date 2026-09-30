// /llms.txt (llmstxt.org): Kurzueberblick fuer KI-Agenten mit Fakten aus dem
// Tarif-Katalog (lib/agent-docs.js). Ersetzt die fruehere statische public/llms.txt.
import { buildLlmsTxt } from "../lib/agent-docs.js";

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
