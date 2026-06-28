// UI-Registry: waehlt hinter dem Master-Schalter (config.mcpUiEnabled) GENAU EINEN
// Renderer. Default = der MCP-native Renderer (offizieller "MCP Apps"-Standard, von
// Claude/Copilot/Goose ... gerendert). Erklaert ein Host explizit die ChatGPT-Skybridge-
// Konvention (disjunkter mimeType), gewinnt dieser Adapter.
//
// KEIN per-Request-Capability-Gate mehr (frueher: nur rendern, wenn der Client die
// UI-Capability im initialize deklariert). Begruendung:
//   1. Das Widget-_meta ist ein Ignore-if-unknown-Feld und der MCP-Apps-Standard
//      garantiert Text-Fallback fuer Hosts ohne UI-Support - es einem nicht-faehigen
//      Host anzubieten schadet nie (Stufe-0-Text liegt immer bei).
//   2. Das alte Gate war NICHT stateless-tauglich: bei sessionIdGenerator=undefined
//      traegt nur der initialize-POST params.capabilities, der spaetere tools/list-POST
//      nicht. Der Renderer war damit auf genau dem Request null, der die Tool-Deskriptoren
//      ausliefert -> es erschien NIE ein Widget (lokal end-to-end reproduziert).
// Master-Schalter aus / kein hostHint (stdio) -> null (Stufe 0, byte-identisch).
import { mcpNativeRenderer } from "./adapters/mcp-native.js";
import { chatgptRenderer } from "./adapters/chatgpt.js";
import { capabilityDeclaresChatgptUi } from "./contract.js";

/**
 * @param {{capabilities?: object, enabled?: boolean}} hostHint
 * @returns {import("./ports.js").UiRenderer | null}
 */
export function uiRendererFor(hostHint) {
  // Master-Schalter aus / kein Hinweis -> gesamter Rich-UI-Pfad inaktiv (Stufe 0).
  if (!hostHint?.enabled) return null;
  // Expliziter ChatGPT-Host (Skybridge-mimeType) -> dessen Adapter; sonst der MCP-native
  // Renderer als Default fuer ALLE Hosts (Text-Fallback per Standard-Garantie).
  if (capabilityDeclaresChatgptUi(hostHint.capabilities)) return chatgptRenderer;
  return mcpNativeRenderer;
}
