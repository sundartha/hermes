import { hasWidget, widgetHtml, widgetTitle, widgetVersion } from "./widget-catalog.js";
import { config } from "../config.js";
import { normalisierterOrigin } from "../middleware.js";

export const UI_MIME = "text/html;profile=mcp-app";
export const UI_CAPABILITY_KEY = "io.modelcontextprotocol/ui";
export const UI_META_KEY = "ui";

const UI_URI_PREFIX = "ui://hermes/";
export const uiResourceUri = (widgetId) => `${UI_URI_PREFIX}${widgetId}/v${widgetVersion(widgetId)}.html`;

function makeCapabilityDetector(mimeType) {
  return (clientCapabilities) => {
    const mimeTypes = clientCapabilities?.extensions?.[UI_CAPABILITY_KEY]?.mimeTypes;
    return Array.isArray(mimeTypes) && mimeTypes.includes(mimeType);
  };
}

export const capabilityDeclaresUi = makeCapabilityDetector(UI_MIME);

export function uiServerExtension() {
  return { [UI_CAPABILITY_KEY]: { mimeTypes: [UI_MIME] } };
}

export const UI_CSP = Object.freeze({
  connectDomains: Object.freeze([]),
  resourceDomains: Object.freeze([]),
});

export const OPENAI_WIDGET_DOMAIN_KEY = "openai/widgetDomain";

export function uiResourceMeta(chatgptEgress = false) {
  const origin = normalisierterOrigin(config.server.publicUrl);
  if (!origin) return { ui: { csp: UI_CSP } };
  const ui = chatgptEgress ? { csp: UI_CSP, domain: origin } : { csp: UI_CSP };
  return { ui, [OPENAI_WIDGET_DOMAIN_KEY]: origin };
}

export function makeUiRenderer({ mimeType, metaKey, buildMeta }) {
  return {
    mimeType,
    hasWidget: (widgetId) => hasWidget(widgetId),
    resourceUri: (widgetId) => uiResourceUri(widgetId),
    registerResource(server, widgetId, { chatgptEgress = false } = {}) {
      const uri = uiResourceUri(widgetId);
      server.registerResource(
        widgetId,
        uri,
        { title: widgetTitle(widgetId), mimeType },
        async () => ({
          contents: [
            { uri, mimeType, text: widgetHtml(widgetId), _meta: uiResourceMeta(chatgptEgress) },
          ],
        }),
      );
    },
    toolMeta: (widgetId) => ({ [metaKey]: buildMeta(uiResourceUri(widgetId)) }),
  };
}
