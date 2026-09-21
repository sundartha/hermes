// UI-Registry: waehlt hinter dem Master-Schalter (config.tenancy.mcpUiEnabled) GENAU EINEN
// Renderer. Default = der MCP-native Renderer (offizieller "MCP Apps"-Standard, von
// Claude/Copilot/Goose ... gerendert). Erklaert der initialize-POST explizit die
// ChatGPT-Skybridge-Konvention (disjunkter mimeType), gewinnt hier auf dem Papier dieser
// Adapter - erreicht auf dem Draht aber praktisch NIE einen tools/list- oder
// resources/read-POST: der stateless Transport (sessionIdGenerator=undefined) fuehrt
// die im initialize-POST deklarierten Capabilities nicht zum naechsten Request mit, und
// kein standardkonformer Client sendet sie ausserhalb des initialize (P8,
// tasks/openai-p8-spec.md §0.3 M-1, Test P8-A). Diese Funktion waehlt also technisch
// korrekt, aber fuer keinen heutigen Client (Claude, OpenAI) mit sichtbarer Wirkung -
// der ChatGPT-Adapter ist tot, nicht nur ungetestet.
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
// Master-Schalter aus -> null (Stufe 0, byte-identisch). stdio (mcp-server.js) liefert
// ebenfalls ein hostHint-Objekt (enabled: config.tenancy.mcpUiEnabled, keine capabilities)
// - dort entscheidet allein der Master-Schalter, kein fehlender Hint.
//
// BEWUSST OFFENE LUECKE (Entscheidung nach widget-wire Runde 2, ChatGPT-Pfad): chatgptRenderer
// bleibt hier verdrahtet und liefert weiterhin BYTE-IDENTISCHES Widget-HTML wie
// mcpNativeRenderer (widgetHtml() aus dem geteilten Katalog, s. Test T-P3-AC5). Seit
// widget-wire (Commit 364da8a) spricht dieses HTML aber AUSSCHLIESSLICH das spec-konforme
// tools/call-postMessage (SEP-1865) - die fruehere host-bedingte Bruecke (u.a.
// window.openai.callTool, die ChatGPT-eigene Konvention) ist restlos raus, weil sie im
// mcp-nativen Host (claude.ai) sichtbare JSON-RPC-Fehler auf unbekannte Methoden
// ausgeloest hat. Fuer einen ECHTEN ChatGPT-Host bedeutet das: der Erst-Aufruf eines
// Tools (z.B. place_call) liefert Text+structuredContent wie immer (MCP-Standard-
// Garantie, unabhaengig vom Iframe), aber die live-aktualisierende Karte selbst
// (Self-Poll, Cancel, get_transcript im Call-Widget) bleibt dort STUMM, weil kein
// Host-seitiger Bridge-Code dieses Wire-Format entgegennimmt.
// Diese Luecke ist NICHT versehentlich: der Adapter wird hier bewusst NICHT entfernt
// (P3 war eine eigene, dual-reviewte Phase - kein Rueckbau in einem Blocker-Fix ohne
// Owner-Auftrag) und ebenso bewusst NICHT mit einer neuen host-bedingten Bruecke
// repariert (keine belegte Live-Probe gegen einen echten ChatGPT-Host; ungetesteter
// Bruecken-Bau ist exakt das Muster, das 364da8a im mcp-nativen Host schon einmal live
// brach). Regressions-Pin: test/mcp-ui.test.js T-P3-AC7.
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
