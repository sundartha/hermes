import { z } from "zod";
import { config } from "../../config.js";

const WEB_SEARCH_TOOL_TYPE = "web_search_20250305";
const WEB_SEARCH_TOOL_NAME = "web_search";
const RECHERCHE_KONFIG = z.object({ research: z.object({ researchMaxUses: z.number() }) });

export const anthropicWebSearch = {
  researchTools: () => [
    {
      type: WEB_SEARCH_TOOL_TYPE,
      name: WEB_SEARCH_TOOL_NAME,
      max_uses: RECHERCHE_KONFIG.parse(config).research.researchMaxUses,
    },
  ],
  searchCount: (providerTurn) => providerTurn?.usage?.server_tool_use?.web_search_requests ?? null,
};
