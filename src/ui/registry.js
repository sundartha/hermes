// UI-Registry: waehlt anhand des Host-Hinweises GENAU EINEN Renderer (analog
// telephony/registry.js). fail-closed: unbekannter/nicht-faehiger Host -> null
// (Aufrufer haengt nichts an, Stufe 0). Nie fail-open.
import { mcpNativeRenderer } from "./adapters/mcp-native.js";
import { chatgptRenderer } from "./adapters/chatgpt.js";
import { capabilityDeclaresUi, capabilityDeclaresChatgptUi } from "./contract.js";

// (host-detektor, renderer): GENAU EIN Adapter pro Host-Hinweis. Marker disjunkt
// (verschiedene UI-mimeTypes); erster Treffer gewinnt (deterministischer Tie-Break
// zugunsten mcp-nativ). Neuer Host = eine Zeile mehr (OCP), ohne den Dispatch zu aendern.
const UI_ADAPTERS = [
  [capabilityDeclaresUi, mcpNativeRenderer],
  [capabilityDeclaresChatgptUi, chatgptRenderer],
];

/**
 * @param {{capabilities?: object, enabled?: boolean}} hostHint
 * @returns {import("./ports.js").UiRenderer | null}
 */
export function uiRendererFor(hostHint) {
  // enabled = Master-Schalter (config, Default aus = byte-identisch). Ohne ihn
  // bleibt der gesamte Rich-UI-Pfad inaktiv (fail-closed, Pre-Mortem #2/#5).
  if (!hostHint?.enabled) return null;
  const match = UI_ADAPTERS.find(([declares]) => declares(hostHint.capabilities));
  return match ? match[1] : null; // unbekannt/nicht-faehig -> Stufe 0
}
