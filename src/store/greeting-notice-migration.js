import { localeFor } from "../i18n/locales.js";
import { withInboundNotice } from "../i18n/inbound-notice.js";
import { tenantLanguage } from "./views.js";

export function backfillGreetingNotices(s) {
  const changed = [];
  for (const [tenantId, settings] of Object.entries(s.settings || {})) {
    if (typeof settings?.greeting !== "string") continue;
    const notice = localeFor(tenantLanguage(s, tenantId)).inboundNotice;
    const next = withInboundNotice(settings.greeting, notice);
    if (next === settings.greeting) continue;
    settings.greeting = next;
    changed.push(tenantId);
  }
  return changed;
}
