import { buildHomeMarkdown } from "../lib/agent-docs.js";
import { LOGIN_URL } from "../lib/routes.js";

export function GET() {
  return new Response(buildHomeMarkdown({ loginUrl: LOGIN_URL }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
