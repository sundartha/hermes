import { mcpNativeRenderer } from "./adapters/mcp-native.js";

export function uiRendererFor(hostHint) {
  if (!hostHint?.enabled) return null;
  return mcpNativeRenderer;
}
