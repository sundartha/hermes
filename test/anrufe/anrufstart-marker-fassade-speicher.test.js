import assert from "node:assert/strict";
import test from "node:test";

import { anrufstartMarker } from "../../src/store.js";

const ZEITPUNKT = "2026-11-17T10:00:00.000Z";

test("Ohne geoeffnetes Backend haelt die Fassade den Anrufstart-Marker im Speicher", async () => {
  const anfrage = { callId: "call_ohne_backend", tenantId: "t_ohne_backend", jetztIso: ZEITPUNKT };
  assert.equal(await anrufstartMarker.lies(anfrage.callId), null);
  assert.equal(await anrufstartMarker.setze(anfrage), true);
  assert.equal(await anrufstartMarker.setze(anfrage), false);
  assert.equal(await anrufstartMarker.lies(anfrage.callId), ZEITPUNKT);
});
