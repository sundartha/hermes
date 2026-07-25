// GAP-14 (tasks/i18n-tests/11-luecken-und-e2e.md): der Inbound-Pflichtsatz (KI-Hinweis +
// Transkriptions-/Aufzeichnungshinweis) ist weder im gesprochenen Erst-Satz vorhanden noch
// gegen ein Abschalten/Entfernen gesichert.
//
// Teil (a): Spawn-Server (Muster test/voice-greeting-tenant.test.js) - der erste gesprochene
// Satz eines Inbound-Calls muss einen Pflicht-Marker fuer KI + Aufzeichnung/Transkription
// tragen.
// Teil (b): reiner Store-Test (Muster test/f1-geo-store.test.js) - updateSettings darf ein
// Greeting OHNE diesen Marker nicht annehmen (fail-closed), auch wenn typeof passt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, OWNER_TEST_NUMBER } from "./helpers.js";
import { makeDefaultState, settingsFor, updateSettings } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Pflicht-Marker: KI-Hinweis + Aufzeichnungs-/Transkriptionshinweis in EINEM Satz. Weder
// DEFAULT_GREETING noch eine der drei GREETING_TEMPLATES traegt aktuell einen
// Aufzeichnungs-/Transkriptionshinweis (nur den KI-Hinweis) - s. Ist-Stand-Beleg
// tasks/i18n-tests/11-luecken-und-e2e.md:409-417.
const MANDATORY_MARKER = /aufgezeichnet|wird transkribiert|mitgeschnitten/i;

test("GAP-14 (a, SOLL rot): erster Inbound-Satz enthaelt einen Pflicht-Marker fuer KI + Aufzeichnung/Transkription", async () => {
  const srv = await startServer({ seed: seedState({}) });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAgap14",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    const body = await res.text();
    assert.match(
      body,
      MANDATORY_MARKER,
      `Pflicht-Marker (KI + Aufzeichnung/Transkription) fehlt im ersten gesprochenen Satz (Launch-Blocker): ${body}`,
    );
  } finally {
    await srv.stop();
  }
});

test("GAP-14 (b, SOLL rot): updateSettings verwirft ein Greeting ohne Pflicht-Marker fail-closed", () => {
  const s = makeDefaultState();
  const before = settingsFor(s, BOOTSTRAP_TENANT_ID).greeting;
  updateSettings(s, BOOTSTRAP_TENANT_ID, { greeting: "Hallo." });
  const after = settingsFor(s, BOOTSTRAP_TENANT_ID).greeting;
  assert.equal(
    after,
    before,
    "updateSettings MUSS ein Greeting ohne Pflicht-Marker (KI + Aufzeichnung) verwerfen (Launch-Blocker: heute passiert jeder String)",
  );
});
