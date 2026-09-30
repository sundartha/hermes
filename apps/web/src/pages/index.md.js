// /index.md: die Startseite als Markdown fuer KI-Agenten (lib/agent-docs.js).
// Render liefert .md als text/markdown aus (wie /agents.md).
import { buildHomeMarkdown } from "../lib/agent-docs.js";
import { LOGIN_URL } from "../lib/routes.js";

export function GET() {
  return new Response(buildHomeMarkdown({ loginUrl: LOGIN_URL }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
