import { WIDGET_AGENT_STATUS } from "../ui/adapters/mcp-native.js";
import { WIDGET_MY_NUMBER } from "../ui/widget-catalog.js";
import { jsonText } from "./ausgabe.js";
import { requireFields } from "./gateway.js";
import { AGENT_STATUS_OUTPUT, MY_NUMBER_OUTPUT } from "./schemata.js";
import { AGENT_STATUS_DESCRIPTION, GET_AGENT_NUMBER_DESCRIPTION } from "./beschreibungen.js";
import { TOOL_ANNOTATIONS } from "./metadaten.js";

function permissionsSummary(settings, labels) {
  return (
    `${labels.summaries}=${settings.allowSummaries}, ${labels.personalData}=${settings.allowPersonalData}, ` +
    `${labels.bankData}=${settings.allowBankData}`
  );
}

function pickAgentStatus(state, texts) {
  return {
    number: state.agent.number ?? null,
    owner: state.agent.owner ?? null,
    calls: state.usage.calls,
    planUsagePercent: state.usage.planUsagePercent ?? null,
    permissions: permissionsSummary(state.settings, texts.permissionLabels),
  };
}

function pickMyNumber(state) {
  return { number: state.agent.number ?? null };
}

export function registerGetAgentNumber({ call, enableWidgetUi, uiTool }) {
  uiTool(
    "get_agent_number",
    {
      description: GET_AGENT_NUMBER_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_agent_number,
      inputSchema: {},
      outputSchema: MY_NUMBER_OUTPUT,
      ...enableWidgetUi(WIDGET_MY_NUMBER),
    },
    async () => {
      const state = await call("GET", "/api/state");
      requireFields(state, { agent: "object" });
      const data = pickMyNumber(state);
      return {
        content: [{ type: "text", text: jsonText({ number: state.agent.number }) }],
        structuredContent: data,
      };
    },
  );
}

function planUsageLine(percent, agentStatusTexts) {
  return percent === null ? agentStatusTexts.planUsageUnknown : agentStatusTexts.planUsage(percent);
}

export function registerGetAgentStatus({ call, loc, enableWidgetUi, uiTool }) {
  uiTool(
    "get_agent_status",
    {
      description: AGENT_STATUS_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_agent_status,
      inputSchema: {},
      outputSchema: AGENT_STATUS_OUTPUT,
      ...enableWidgetUi(WIDGET_AGENT_STATUS),
    },
    async () => {
      const state = await call("GET", "/api/state");
      requireFields(state, { agent: "object", usage: "object", settings: "object" });
      const data = pickAgentStatus(state, loc.mcp);
      const agentStatusTexts = loc.mcp.agentStatus;
      return {
        content: [
          {
            type: "text",
            text:
              `${agentStatusTexts.number}: ${data.number}\n${agentStatusTexts.owner}: ${data.owner}\n` +
              `${agentStatusTexts.calls}: ${data.calls}\n` +
              `${planUsageLine(data.planUsagePercent, agentStatusTexts)}\n` +
              `${agentStatusTexts.permissions}: ${data.permissions}`,
          },
        ],
        structuredContent: data,
      };
    },
  );
}
