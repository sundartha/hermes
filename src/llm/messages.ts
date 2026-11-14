export const TOOL_RESULTS_ROLE = "toolResults";

export const providerTurnMessage = (providerTurn: unknown): { role: "assistant"; providerTurn: unknown } => ({ role: "assistant", providerTurn });

export const toolResultsMessage = (results: unknown): { role: typeof TOOL_RESULTS_ROLE; results: unknown } => ({ role: TOOL_RESULTS_ROLE, results });
