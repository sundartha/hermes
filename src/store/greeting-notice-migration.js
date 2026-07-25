// O7-Migration (GAP-14): Bestandsgreetings bekommen den Pflichtsatz EINMALIG
// nachgeruestet - nicht bei jedem Write geprueft. Idempotent (withInboundNotice ist
// no-op, sobald der Marker steht) -> zweiter Lauf aendert 0 Zeilen.
// Reine In-Memory-Operation auf dem geteilten State-Shape; beide Backends rufen sie
// (json.js finishLoad, pg.js init) und persistieren selbst - KEIN IO hier.
import { localeFor } from "../i18n/locales.js";
import { withInboundNotice } from "../i18n/inbound-notice.js";
import { tenantLanguage } from "./views.js";

// Nebeneffekt im Namen (N7): mutiert s.settings. Liefert die geaenderten tenantIds,
// damit der Aufrufer gezielt (und nur bei echter Aenderung) flusht.
export function backfillGreetingNotices(s) {
  const changed = [];
  for (const [tenantId, settings] of Object.entries(s.settings || {})) {
    // Nicht-String (z.B. roh geseedetes null, s. test/voice-incoming-catch-path)
    // bleibt UNBERUEHRT - eine Migration darf keinen Fehlerpfad ueberkleben.
    if (typeof settings?.greeting !== "string") continue;
    const notice = localeFor(tenantLanguage(s, tenantId)).inboundNotice;
    const next = withInboundNotice(settings.greeting, notice);
    if (next === settings.greeting) continue;
    settings.greeting = next;
    changed.push(tenantId);
  }
  return changed;
}
