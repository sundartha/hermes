import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { OAUTH_SCOPES } from "./auth.js";
import { MCP_RETIRED_TOOL_NOTICE } from "./i18n/mcp-texts.js";

export const TOOL_SECURITY_SCHEMES = Object.freeze([
  Object.freeze({ type: "oauth2", scopes: OAUTH_SCOPES }),
]);

export const NOAUTH_TOOL_SECURITY_SCHEMES = Object.freeze([Object.freeze({ type: "noauth" })]);

const LIST_TOOLS_METHOD = "tools/list";

function activeSecuritySchemes(mcpAuthMode) {
  if (mcpAuthMode === "oauth") return TOOL_SECURITY_SCHEMES;
  if (mcpAuthMode === "off") return NOAUTH_TOOL_SECURITY_SCHEMES;
  return null;
}

const mitSecuritySchemes = (tool, schemes) => (schemes ? { ...tool, securitySchemes: schemes } : tool);

export function applyToolSecuritySchemes(server, mcpAuthMode = config.auth.mcpAuth) {
  const protokoll = server.server;
  const original = protokoll._requestHandlers?.get(LIST_TOOLS_METHOD);
  if (!original)
    throw new Error(
      "MCP-SDK-Naht verloren: kein tools/list-Handler zum Anreichern (securitySchemes, T-15)",
    );
  const schemes = activeSecuritySchemes(mcpAuthMode);
  protokoll.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const ergebnis = await original(request, extra);
    return { ...ergebnis, tools: ergebnis.tools.map((tool) => mitSecuritySchemes(tool, schemes)) };
  });
}

const CALL_TOOL_METHOD = "tools/call";
const RETIRED_TOOL = "prepare_call";

export function applyRetiredToolNotice(server) {
  const protokoll = server.server;
  const original = protokoll._requestHandlers.get(CALL_TOOL_METHOD);
  protokoll.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name !== RETIRED_TOOL) return original(request, extra);
    return { content: [{ type: "text", text: MCP_RETIRED_TOOL_NOTICE }], isError: true };
  });
}
