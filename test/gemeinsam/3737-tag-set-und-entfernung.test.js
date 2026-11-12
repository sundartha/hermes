import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";

let store;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-3737-"));
  await import("../../src/config.js");
  store = await import("../../src/store.js");
});

const neuerAnruf = () =>
  store.createCall({
    direction: "outbound",
    from: "+4930123456",
    to: "+4989123456",
    tenantId: "tenant-3737",
    maxDurationS: 60,
  });

const ersterEintrag = (call) => store.getCall(call.id).transcript[0];

const FAELLE = [
  ["[calm] Guten Tag.", "Guten Tag."],
  ["[freundlich] Super, dann passt das.", "Super, dann passt das."],
  ["Ja [thoughtful] also gut [softly].", "Ja also gut."],
  ["[warmly][patient] Moment.", "Moment."],
  ["Ende. [calm]", "Ende."],
  ["Ohne Marke.", "Ohne Marke."],
  ["Pouvez-vous répéter ?", "Pouvez-vous répéter ?"],
  ["Oui : le rendez-vous est à 15 h !", "Oui : le rendez-vous est à 15 h !"],
  ["Oui [calm] : voilà !", "Oui : voilà !"],
  ["Offene Klammer [ bleibt", "Offene Klammer [ bleibt"],
  ["Zeile [eins\nzwei] bleibt", "Zeile [eins\nzwei] bleibt"],
];

for (const [eingabe, erwartet] of FAELLE) {
  test(`Transkript speichert ${JSON.stringify(eingabe)} als ${JSON.stringify(erwartet)}`, () => {
    const call = neuerAnruf();
    store.addTranscript(call.id, "agent", eingabe);
    assert.equal(ersterEintrag(call).text, erwartet);
  });
}

test("Transkript: Klammern des Gegenübers werden nicht gespeichert", () => {
  const call = neuerAnruf();
  store.addTranscript(call.id, "caller", "Sag mal [excited] etwas.");
  assert.equal(ersterEintrag(call).text, "Sag mal etwas.");
  assert.equal(ersterEintrag(call).role, "caller");
});

test("Zusammenfassung des Anbieters: Tags fallen weg, fehlende Zusammenfassung bleibt null", () => {
  const call = neuerAnruf();
  store.recordProviderCallResult(call.id, { summary: "[warmly] Termin vereinbart.", objectiveAchieved: "unknown" });
  assert.equal(store.getCall(call.id).summary, "Termin vereinbart.");
  store.recordProviderCallResult(call.id, { summary: null, objectiveAchieved: "unknown" });
  assert.equal(store.getCall(call.id).summary, null);
});
