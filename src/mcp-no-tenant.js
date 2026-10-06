import { registerTools } from "./mcp-tools.js";
import { oauthBearerChallenge } from "./auth.js";
import { MCP_ERROR_CODE } from "./i18n/mcp-texts.js";
import { localeFor } from "./i18n/locales.js";
import { TENANT_REJECT } from "./request-tenant.js";

const NO_TENANT_ERROR = "insufficient_scope";
const NO_TENANT_DESCRIPTION = "No Hermes account is linked to this login";

const MCP_WWW_AUTHENTICATE_META = "mcp/www_authenticate";

export function buildNoTenantResult(language) {
  const text = localeFor(language).mcp.errors[MCP_ERROR_CODE.NO_TENANT_LINKED];
  return Object.freeze({
    content: Object.freeze([Object.freeze({ type: "text", text })]),
    isError: true,
    _meta: Object.freeze({
      [MCP_WWW_AUTHENTICATE_META]: Object.freeze([oauthBearerChallenge(NO_TENANT_ERROR, NO_TENANT_DESCRIPTION)]),
    }),
  });
}

function noTenantFacade(server, stubHandler) {
  return {
    registerTool: (name, config) => server.registerTool(name, config, stubHandler),
    registerResource: (...args) => server.registerResource(...args),
  };
}

export function _noTenantFacade(server, stubHandler) {
  return noTenantFacade(server, stubHandler);
}

export function registerNoTenantStubs(server, toolContext) {
  const result = buildNoTenantResult(toolContext.language);
  const stubHandler = async () => result;
  registerTools(noTenantFacade(server, stubHandler), { ...toolContext, scopedTenant: TENANT_REJECT });
}
