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
