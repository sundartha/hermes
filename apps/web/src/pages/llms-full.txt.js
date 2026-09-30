// /llms-full.txt: Startseite + Agenten-Anleitung (public/agents.md) in einer Datei.
// agents.md wird zur Build-Zeit gelesen; der Build laeuft immer in apps/web
// (Render rootDir, npm run build, test/pages.test.js).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLlmsFull } from "../lib/agent-docs.js";
import { LOGIN_URL } from "../lib/routes.js";

export function GET() {
  const agentGuide = readFileSync(join(process.cwd(), "public", "agents.md"), "utf8");
  return new Response(buildLlmsFull({ loginUrl: LOGIN_URL, agentGuide }), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
