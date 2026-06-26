// UI-Registry: waehlt anhand des Host-Hinweises GENAU EINEN Renderer (analog
// telephony/registry.js). P1: nur der MCP-native Adapter. ChatGPT-Apps -> P3.
// fail-closed: unbekannter/nicht-faehiger Host -> null (Aufrufer haengt nichts an,
// Stufe 0). Nie fail-open.
import { mcpNativeRenderer } from "./adapters/mcp-native.js";
import { capabilityDeclaresUi } from "./contract.js";

/**
 * @param {{capabilities?: object, enabled?: boolean}} hostHint
 * @returns {import("./ports.js").UiRenderer | null}
 */
export function uiRendererFor(hostHint) {
  // enabled = Master-Schalter (config, Default aus = byte-identisch). Ohne ihn
  // bleibt der gesamte Rich-UI-Pfad inaktiv (fail-closed, Pre-Mortem #2/#5).
  if (!hostHint?.enabled) return null;
  if (capabilityDeclaresUi(hostHint.capabilities)) return mcpNativeRenderer;
  return null;
}
