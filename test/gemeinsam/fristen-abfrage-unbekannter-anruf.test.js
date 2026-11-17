import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const { speicher } = await jsonSpeicherImDatenordner("hermes-fristen-abfrage-unbekannt-");
await speicher.oeffneSpeicher();

test("Abfrage-Frist im JSON-Speicher: eine unbekannte Anruf-Kennung wirft nicht und aendert keinen Anruf", async () => {
  const call = speicher.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: "t_unbekannt" });
  const vorher = JSON.stringify(speicher.getCall(call.id));
  await speicher.setzeAbfrageFrist({ callId: "call_gibt_es_nicht", tenantId: "t_unbekannt", faelligAt: "2031-05-06T07:08:09.000Z" });
  assert.equal(JSON.stringify(speicher.getCall(call.id)), vorher);
  assert.ok(!speicher.getCall("call_gibt_es_nicht"));
});
