import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonSpeicherImDatenordner } from "./json-speicher-im-datenordner.js";

const MANDANT = "t_fehlerserie_json";
const DRITTER_FEHLER = 3;

const { speicher } = await jsonSpeicherImDatenordner("hermes-fehlerserie-");
await speicher.oeffneSpeicher();

const anruf = (status = "active") => {
  const call = speicher.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: MANDANT });
  call.status = status;
  return call;
};

test("Fehlerserie im JSON-Speicher: dauerhafte Fehler zaehlen am Call-Objekt hoch, ein anderer Anruf bleibt bei 0", async () => {
  const call = anruf();
  const fremd = anruf();
  const staende = [];
  for (let i = 0; i < DRITTER_FEHLER; i += 1) {
    staende.push(await speicher.fortschreibeFehlerserie({ callId: call.id, tenantId: MANDANT, permanent: true }));
  }
  assert.deepEqual(staende, [1, 2, DRITTER_FEHLER]);
  assert.equal(call.permanentFehlerSerie, DRITTER_FEHLER);
  assert.equal(fremd.permanentFehlerSerie, undefined);
});

test("Fehlerserie im JSON-Speicher: ein Fehler ohne Dauerstatus setzt die Serie auf 0", async () => {
  const call = anruf();
  await speicher.fortschreibeFehlerserie({ callId: call.id, tenantId: MANDANT, permanent: true });
  assert.equal(await speicher.fortschreibeFehlerserie({ callId: call.id, tenantId: MANDANT, permanent: false }), 0);
  assert.equal(await speicher.fortschreibeFehlerserie({ callId: call.id, tenantId: MANDANT, permanent: true }), 1);
});

test("Fehlerserie im JSON-Speicher: ein beendeter oder unbekannter Anruf bleibt unveraendert und liefert keinen Stand", async () => {
  const beendet = anruf("completed");
  assert.equal(await speicher.fortschreibeFehlerserie({ callId: beendet.id, tenantId: MANDANT, permanent: true }), undefined);
  assert.equal(beendet.permanentFehlerSerie, undefined);
  assert.equal(await speicher.fortschreibeFehlerserie({ callId: "call_gibt_es_nicht", tenantId: MANDANT, permanent: true }), undefined);
});
