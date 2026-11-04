import { uiRendererFor } from "../ui/registry.js";
import { WIDGET_CALL } from "../ui/widget-catalog.js";
import { localeFor } from "../i18n/locales.js";
import { toolErrorText } from "./fehler.js";
import { errText, makeDateFormatter } from "./ausgabe.js";
import { boundedHop, placeCallHop, pollConsultHop } from "./gateway.js";
import { withOpenAiToolMetadata, widgetResourceOptions, withWidgetLocale } from "./metadaten.js";

export function createToolContext(
  server,
  { identity = null, scopedTenant = null, consultAllowed = false, uiHost = null, language = null },
  begriffe,
) {
  const call = (method, path, body) => boundedHop({ method, path, body, identity, scopedTenant });
  const pollConsult = (path) => pollConsultHop({ identity, scopedTenant, path });
  const placeCallHopCall = (body) => placeCallHop({ identity, scopedTenant, body });
  const loc = localeFor(language);
  const formatDate = makeDateFormatter(loc.dateLocale);
  const uiRenderer = uiRendererFor(uiHost);

  const enableWidgetUi = (widgetId) => {
    if (!uiRenderer || !uiRenderer.hasWidget(widgetId)) return {};
    uiRenderer.registerResource(server, widgetId, widgetResourceOptions(uiHost));
    return { _meta: uiRenderer.toolMeta(widgetId) };
  };

  const wrapHandler =
    (handler) =>
    async (...args) => {
      try {
        return await handler(...args);
      } catch (err) {
        return errText(toolErrorText(err, loc.mcp));
      }
    };

  const uiTool = (name, config, handler) =>
    server.registerTool(
      name,
      withOpenAiToolMetadata(name, config),
      wrapHandler(withWidgetLocale(config, handler, loc.language)),
    );

  return {
    identity,
    scopedTenant,
    consultAllowed,
    begriffe,
    call,
    pollConsult,
    placeCallHopCall,
    loc,
    formatDate,
    enableWidgetUi,
    uiTool,
    callWidgetUi: enableWidgetUi(WIDGET_CALL),
  };
}
