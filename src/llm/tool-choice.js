export const LLM_TOOL_CHOICE = Object.freeze({ AUTO: "auto", REQUIRED: "required" });

export const forcedTool = (name) => ({ tool: name });
