export const TOOL_RESULTS_ROLE = "toolResults";

export const providerTurnMessage = (providerTurn) => ({ role: "assistant", providerTurn });

export const toolResultsMessage = (results) => ({ role: TOOL_RESULTS_ROLE, results });
