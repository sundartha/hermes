import { mcpNativeRenderer } from "./adapters/mcp-native.js";

export { chatgptEgressStand, isChatGptEgressIp } from "./chatgpt-egress.js";
export { widgetPins } from "./widget-catalog.js";

export function uiRendererFor(hostHint) {
  if (!hostHint?.enabled) return null;
  return mcpNativeRenderer;
}
