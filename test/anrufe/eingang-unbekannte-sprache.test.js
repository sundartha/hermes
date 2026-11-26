import assert from "node:assert/strict";
import { test } from "node:test";

import { elevenlabsOutbound } from "../../src/elevenlabs/registry.ts";
import { localeFor } from "../../src/i18n/locales.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";

const { inboundElLocaleOf, callLocaleOf } = elevenlabsOutbound();

const SPRACHE_OHNE_TEXT = "xx";

const store = {
  load: () => ({ settings: { language: "de" }, tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
  numberRecordByE164: () => null,
};

const anruf = { tenantId: BOOTSTRAP_TENANT_ID, from: "+4915100000001", to: "+4930000000", language: SPRACHE_OHNE_TEXT };

test("eingehend mit unbekannter Sprache bleibt auf der Textsprache fuer agent.language und first_message", () => {
  const locale = inboundElLocaleOf({ store, call: anruf });
  assert.equal(locale.providerLanguage, locale.language);
  assert.equal(locale.language, localeFor(SPRACHE_OHNE_TEXT).language);
  assert.notEqual(locale.providerLanguage, SPRACHE_OHNE_TEXT);
});

test("ausgehend reicht dieselbe unbekannte Sprache an den Anbieter durch", () => {
  const locale = callLocaleOf({ store, call: anruf, ownerName: null });
  assert.equal(locale.providerLanguage, SPRACHE_OHNE_TEXT);
});
