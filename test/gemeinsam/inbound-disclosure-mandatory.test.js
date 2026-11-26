import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, settingsFor, updateSettings } from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { INBOUND_NOTICES } from "../../src/i18n/inbound-notice.ts";

test("Inbound-Pflichtsatz: updateSettings verwirft NUR das Greeting ohne Marker, der Rest des Patches laeuft durch (ex GAP-14 b)", () => {
  const s = makeDefaultState();
  const before = settingsFor(s, BOOTSTRAP_TENANT_ID).greeting;
  const { changed } = updateSettings(s, BOOTSTRAP_TENANT_ID, {
    greeting: "Hallo.",
    agentName: "Neu",
  });
  const after = settingsFor(s, BOOTSTRAP_TENANT_ID);
  assert.equal(after.greeting, before, "Greeting ohne Pflicht-Marker MUSS verworfen werden");
  assert.equal(after.agentName, "Neu", "der uebrige Patch MUSS trotzdem durchlaufen");
  assert.ok(changed.includes("agentName"), "agentName MUSS in changed stehen");
  assert.ok(!changed.includes("greeting"), "greeting DARF NICHT in changed stehen");
});

test("Inbound-Pflichtsatz: ein Greeting MIT Marker wird angenommen (Gegenprobe)", () => {
  const s = makeDefaultState();
  const withMarker = `${INBOUND_NOTICES.de} Hallo, hier spricht Hermes.`;
  const { changed } = updateSettings(s, BOOTSTRAP_TENANT_ID, { greeting: withMarker });
  assert.equal(settingsFor(s, BOOTSTRAP_TENANT_ID).greeting, withMarker);
  assert.ok(changed.includes("greeting"));
});
