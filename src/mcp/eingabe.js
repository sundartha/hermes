import { MCP_ERROR_CODE } from "../i18n/mcp-texts.js";
import { RESTRICTED_CATEGORY, firstRestrictedField } from "../restricted-data.js";
import { ToolError } from "./fehler.js";

const RESTRICTED_CATEGORY_ERROR_CODE = Object.freeze({
  [RESTRICTED_CATEGORY.PAYMENT_CARD]: MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD,
  [RESTRICTED_CATEGORY.GOVERNMENT_ID]: MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID,
  [RESTRICTED_CATEGORY.CREDENTIAL_SECRET]: MCP_ERROR_CODE.RESTRICTED_CREDENTIAL,
});

export const CALL_ARGS_EXEMPT_KEYS = Object.freeze(["to", "confirmation_code", "language"]);

export function rejectRestrictedData(body, exemptKeys) {
  const hit = firstRestrictedField(body, exemptKeys);
  if (hit) throw new ToolError(RESTRICTED_CATEGORY_ERROR_CODE[hit.category], hit.field);
}
