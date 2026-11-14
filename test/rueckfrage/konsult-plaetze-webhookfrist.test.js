import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../../src/config.js";
import { CONSULT_POLL_ABORT_MARGIN_MS, makeConsultDelivery } from "../../src/consult/delivery.js";
import { makeKonsultPlaetze } from "../../src/store.js";

const ABRUF_FRIST_MS = 25_000;
const WEBHOOK_FRIST_MS = config.tenancy.elConsultAnswerMs + CONSULT_POLL_ABORT_MARGIN_MS;

function zweiOffene() {
  const uhr = { jetzt: 1_000_000 };
  const zustellung = makeConsultDelivery({
    store: {},
    konsultPlaetze: makeKonsultPlaetze({ jetztMs: () => uhr.jetzt }),
  });
  const offen = [];
  const halte = () =>
    zustellung.withOpenSlot("c1", "t1", () => new Promise((fertig) => offen.push(fertig)));
  halte();
  halte();
  return { uhr, zustellung, offen };
}

test("Ein laufender Webhook behaelt seinen Platz ueber die 25 s des Abrufs hinaus: der dritte Aufruf wird abgewiesen", async () => {
  const { uhr, zustellung } = zweiOffene();
  await Promise.resolve();
  uhr.jetzt += ABRUF_FRIST_MS + 1_000;
  const dritter = await zustellung.withOpenSlot("c1", "t1", async () => "drin");
  assert.deepEqual(dritter, { granted: false, value: null });
});

test("Der Webhook-Platz verfaellt genau mit Antwortfrist plus Rand, eine Millisekunde davor zaehlt er noch", async () => {
  const { uhr, zustellung } = zweiOffene();
  await Promise.resolve();
  uhr.jetzt += WEBHOOK_FRIST_MS - 1;
  assert.equal((await zustellung.withOpenSlot("c1", "t1", async () => "drin")).granted, false);
  uhr.jetzt += 1;
  assert.deepEqual(await zustellung.withOpenSlot("c1", "t1", async () => "drin"), {
    granted: true,
    value: "drin",
  });
});
